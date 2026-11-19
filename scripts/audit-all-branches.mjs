// Read-only GitHub Actions audit: compare EVERY source branch's changed blob
// contents with main and the current sandbox candidate. Never cherry-pick,
// merge or alter real code. Output is an artifact, not a release approval.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const git = (...args) => execFileSync('git', args, {encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const base = 'origin/main';
const candidate = 'HEAD';
const branches = git('for-each-ref','--format=%(refname:short)','refs/remotes/origin/')
  .split('\n').filter(x=>x && x !== 'origin/HEAD').sort();
const readTree = ref => {
  const map = new Map();
  for(const line of git('ls-tree','-r','--full-tree',ref).split('\n')){
    const at=line.indexOf('\t'); if(at<0)continue;
    const meta=line.slice(0,at).split(' ');
    if(meta[1]!=='blob')continue;
    map.set(line.slice(at+1),meta[2]);
  }
  return map;
};
const mainTree=readTree(base), candTree=readTree(candidate);
const results=[];
for(const branch of branches){
  const changed = git('diff','--name-only','--no-renames',base+'...'+branch)
    .split('\n').filter(Boolean);
  const tree=readTree(branch);
  const classifications={identical:[],missing:[],overlap:[]};
  for(const path of changed){
    const ours=candTree.get(path)??null,source=tree.get(path)??null, main=mainTree.get(path)??null;
    if(ours===source)classifications.identical.push(path);
    else if(ours===main)classifications.missing.push(path);
    else classifications.overlap.push(path);
  }
  const category=/^design\/|20261114|2026-11-14|cinematic|visual-frozen/.test(branch)
    ? 'archive-visual-review-logic-separately'
    : /techbase|vehicle|catalog|community|ether|air|parts/.test(branch)?'techbase-catalog-community'
    : /payment|bank|tochka|fee|invoice|tax|shop|agent/.test(branch)?'financial-requires-approval'
    : /auth|otp|security|sms|token/.test(branch)?'security'
    : /sandbox|integration|release|deploy|vps/.test(branch)?'release-infrastructure'
    : 'functional-review';
  results.push({branch,category,changed:changed.length,...classifications,
    counts:Object.fromEntries(Object.entries(classifications).map(([key,paths])=>[key,paths.length]))});
}
const out='audit-out';
mkdirSync(out,{recursive:true});
const md=[
'# TrakSOS · сравнение всех веток по содержимому файлов',
'Автоматическая, **только читающая** ревизия: исходники не удалены, main/VPS не изменены.',
'Сравнение: `origin/main` ↔ каждая существующая удалённая ветка ↔ `HEAD` единого sandbox.',
'**Совпадает** — SHA содержимого файла равен; **не перенесено** — кандидат совпадает с main;',
'**пересечение** — путь изменён и в кандидате, и в ветке по-разному: нужна ручная сверка логики.',
'Совпадение путей/содержимого не является доказательством, что вся функция работает.',
'',
'| Ветка | Тип | Файлов ветки | Совпало | Не перенесено | Конфликтное пересечение |',
'|---|---|---:|---:|---:|---:|',
...results.map(r=>`| \`\${r.branch}\` | \${r.category} | \${r.changed} | \${r.counts.identical} | \${r.counts.missing} | \${r.counts.overlap} |`),
'',
'Полный перечень путей по каждой ветке: `branch-audit.json`. Удалять старые дизайны из текущего релиза разрешено,',
'но переносить из старых веток серверную функциональность — только после ручной проверки контрактов, CI, прав и миграций.',
].join('\n');
writeFileSync(join(out,'branch-audit.md'),md);
writeFileSync(join(out,'branch-audit.json'),JSON.stringify({generatedAt:new Date().toISOString(),
  main:git('rev-parse',base),candidate:git('rev-parse',candidate),branches:results},null,2));
console.log('Audited remote branches:',results.length,'candidate:',git('rev-parse','--short',candidate));
console.log('With unported files:',results.filter(x=>x.missing.length).length,
  'with divergent paths:',results.filter(x=>x.overlap.length).length);
