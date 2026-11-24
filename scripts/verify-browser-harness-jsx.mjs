// Static preflight for the real browser fixtures listed in the main CI.
 // No Chromium, server, APK, database or network access required.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

function props(node, key) {
  return node && ts.isObjectLiteralExpression(node)
    ? node.properties.filter(p => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === key)
    : [];
}
function value(node, key) {
  const list = props(node, key);
  return list.length === 1 && ts.isPropertyAssignment(list[0]) ? list[0].initializer : undefined;
}
function literal(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}
function inspect(source, file) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const builds = new Set();
  const errors = [];
  let checked = 0;
  for (const stmt of ast.statements) {
    if (!ts.isImportDeclaration(stmt) || literal(stmt.moduleSpecifier) !== 'esbuild') continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === 'build') builds.add(element.name.text);
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && builds.has(node.expression.text)) {
      const options = node.arguments[0];
      const stdin = value(options, 'stdin');
      const loader = literal(value(stdin, 'loader'));
      const sourcefile = literal(value(stdin, 'sourcefile')) ?? '';
      const entries = value(options, 'entryPoints');
      const jsx = props(options, 'jsx');
      const reactInput = ['tsx', 'jsx'].includes(loader) || /\.[jt]sx$/.test(sourcefile)
        || (entries && ts.isArrayLiteralExpression(entries) && entries.elements.some(e => /\.[jt]sx$/.test(literal(e) ?? '')));
      if (literal(value(options, 'platform')) !== 'node' && (reactInput || jsx.length)) {
        checked++;
        const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
        if (jsx.length !== 1 || literal(value(options, 'jsx')) !== 'automatic')
          errors.push(file + ':' + line + ': expected exactly one jsx: automatic for the browser React build; found ' + jsx.length);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return {checked, errors};
}

// Exercise the exact guard before trusting it on repository files.
const fixture = (option) => "import {build as compile} from 'esbuild';\ncompile({platform:'browser',stdin:{loader:'tsx'}, " + option + "});";
assert.equal(inspect(fixture("jsx:'automatic'"), 'good.mjs').errors.length, 0);
assert.equal(inspect(fixture(""), 'missing.mjs').errors.length, 1);
assert.equal(inspect(fixture("jsx:'automatic',jsx:'automatic'"), 'duplicate.mjs').errors.length, 1);
assert.equal(inspect(fixture("jsx:'transform'"), 'classic.mjs').errors.length, 1);
assert.equal(inspect(fixture("/* jsx:'automatic' */"), 'comment.mjs').errors.length, 1);
assert.equal(inspect("import {build} from 'esbuild';build({platform:'browser',stdin:{loader:'ts'}})", 'pure-ts.mjs').checked, 0);
assert.equal(inspect("import {build} from 'esbuild';build({platform:'node',entryPoints:['test.tsx']})", 'node.mjs').checked, 0);
assert.equal(inspect("import {build} from 'esbuild';build({entryPoints:['test.tsx']})", 'entry.mjs').errors.length, 1);

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const files = [...new Set([...workflow.matchAll(/^\s*(?:[A-Z_]+=[^\s]+\s+)*node\s+(e2e\/[\w./-]+\.mjs)(?:\s|$)/gm)].map(m => m[1]))];
assert.ok(files.length >= 20, 'Could not enumerate active CI browser scripts');
let checked = 0;
const errors = [];
for (const file of files) {
  const result = inspect(readFileSync(file, 'utf8'), file);
  checked += result.checked;
  errors.push(...result.errors);
}
assert.ok(checked >= 20, 'React preflight did not find the expected fixture builds');
assert.equal(errors.length, 0, errors.join('\n'));
console.log('PASS: browser JSX preflight, 8 controls, ' + checked + ' React builds across ' + files.length + ' CI scripts');
