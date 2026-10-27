const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { root, fixtures, cases } = require('./lib/grammar.cjs');
async function main() {
  const update = process.argv.includes('--update');
  // Never bless generated output until independent spec assertions pass.
  if (update) await require('./semantic.cjs').main();
  const files = [...fixtures(), ...cases()];
  if (!update) for (const file of files) assert(fs.existsSync(path.join(root, `${file}.snap`)), `Missing snapshot ${file}.snap; run bun run test:snapshots:update after reviewing semantic checks`);
  // vscode-tmgrammar-test publishes the requested vscode-tmgrammar-snap binary.
  const binary = require.resolve('vscode-tmgrammar-test/dist/snapshot.js');
  const args = [binary, '-g', 'syntaxes/elyx.tmLanguage.json', '-s', 'source.elyx', ...files];
  if (update) args.push('--updateSnapshot');
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  fs.mkdirSync(path.join(root, 'test/output'), { recursive: true });
  fs.writeFileSync(path.join(root, `test/output/snapshots${update ? '-update' : ''}.log`), (run.stdout || '') + (run.stderr || ''));
  process.stdout.write(run.stdout || '');
  process.stderr.write(run.stderr || '');
  assert.ifError(run.error);
  assert.equal(run.status, 0, 'vscode-tmgrammar-snap failed');
  console.log(`${files.length} snapshots ${update ? 'updated' : 'passed'} (${fixtures().length} sample fixtures, ${cases().length} specification cases).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
