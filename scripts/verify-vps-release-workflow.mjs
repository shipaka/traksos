// Dependency-free static release safety gate. No production secrets or SSH required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const path = '.github/workflows/deploy-vps-manual.yml';
const file = readFileSync(path, 'utf8');
function guard(condition, message) { assert.ok(condition, message); }

guard(/^on:\n  workflow_dispatch:/m.test(file), 'Release is manual only');
guard(!/^  (push|pull_request|schedule|workflow_run):/m.test(file), 'No automated production triggers');
guard(file.includes('environment: production'), 'Production environment authorization gate');
guard(file.includes('concurrency:\n  group: traksos-production-release'), 'Release concurrency lock');
guard(file.includes('permissions:\n  contents: read'), 'Minimal GitHub token');
guard(file.includes('RELEASE_CONFIRMATION'), 'Explicit operator confirmation');
guard(file.includes('git rev-parse HEAD') && file.includes('$TARGET_SHA'), 'Exact SHA guard');
guard(file.includes('git merge-base --is-ancestor HEAD origin/main'), 'VPS fast-forward-only ancestry gate');
guard(file.includes('git -c core.hooksPath=/dev/null merge --ff-only origin/main'), 'Fast-forward-only without local hooks');
guard(file.includes('StrictHostKeyChecking=yes'), 'Pinned SSH host');
guard(file.includes('ssh-keygen -lf "$HOME/.ssh/known_hosts"'), 'Pinned key validates');
guard(file.includes('VPS_READONLY_KEY') && file.includes('$VPS_SSH_KEY" != "$VPS_READONLY_KEY"'), 'Read-only key not deployed');
guard(file.includes('TRAKSOS_RELEASE_COMPLETE='), 'Forced-command status cannot impersonate deployment');
guard(file.includes('TRAKSOS_SANDBOX_DIR=/root/traksos-sandbox/deploy'), 'External sandbox is required');
guard(file.includes('bash deploy/update-site.sh'), 'Backup and isolated sandbox launch guard');
guard(file.includes('https://traksos.ru/api/health'), 'Public HTTPS release verification');
guard(file.includes('h.buildRevision!==process.env.TARGET_SHA'), 'Exact public release SHA verification');
guard(!/^\s*(?:sudo\s+)?(?:rm\s+-rf|git\s+reset\s+--hard|docker\s+compose\s+down)\b/m.test(file), 'No destructive commands');

const ruby = spawnSync('ruby', ['-ryaml', '-rjson', '-e',
  'doc=YAML.load_file(ARGV[0]); steps=doc.fetch("jobs").fetch("deploy").fetch("steps"); puts JSON.generate(steps.filter_map{|s|s["run"]})',
  path], {encoding:'utf8'});
if (ruby.status !== 0) throw Error('YAML parse failed: '+ruby.stderr);
const scripts = JSON.parse(ruby.stdout);
guard(scripts.length >= 5, 'Expected production release Bash steps');
for (let index=0; index<scripts.length; index++) {
  const result = spawnSync('bash', ['-n'], { input: scripts[index], encoding:'utf8' });
  if (result.status !== 0) throw Error('Bash syntax invalid in step '+(index+1)+': '+result.stderr);
}
console.log('OK: manual-only workflow, SHA/key/backup/sandbox guardrails and '+scripts.length+' shell steps parse cleanly.');
