const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { root, fixtures } = require('./lib/grammar.cjs');
const cli = process.env.ELYX_CLI || '/Applications/Elyx Preview.app/Contents/Resources/bin/elyx';
const output = path.join(root, 'test/output/diagnostics');
fs.mkdirSync(output, { recursive: true });
const summary = [];
for (const file of fixtures()) {
  const run = spawnSync(cli, ['diagnostics', file], { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  const name = path.basename(file, '.elyx');
  fs.writeFileSync(path.join(output, `${name}.stdout.json`), run.stdout || '');
  fs.writeFileSync(path.join(output, `${name}.stderr.log`), run.stderr || '');
  assert.ifError(run.error);
  assert(run.status === 0 || run.status === 1, `${file}: Elyx terminated with status ${run.status}`);
  const report = JSON.parse(run.stdout);
  assert.equal(typeof report.summary?.errors, 'number', `${file}: missing errors summary`);
  assert.equal(typeof report.summary?.warnings, 'number', `${file}: missing warnings summary`);
  const result = { file, errors: report.summary.errors, warnings: report.summary.warnings, exitCode: run.status };
  summary.push(result);
  console.log(`${file}: ${result.errors} errors, ${result.warnings} warnings (CLI exit ${run.status})`);
}
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
assert.equal(summary.length, 9);
assert.equal(summary.reduce((n,r) => n + r.errors, 0), 0, 'Elyx reported errors; see individual JSON reports');
console.log('All nine sample fixtures have 0 errors. The only expected warnings are font files named by `use` that the sample project does not ship.');
