const fs = require('node:fs');
const path = require('node:path');
const { root, fixtures, loadGrammar, tokenize } = require('./lib/grammar.cjs');
async function main() {
  const grammar = await loadGrammar();
  const output = path.join(root, 'test/output/tokens-first-40.txt');
  const chunks = [];
  for (const file of fixtures()) {
    const start = chunks.length;
    chunks.push(`FILE ${file}`);
    for (const row of tokenize(grammar, file).slice(0, 40)) {
      chunks.push(`${row.number}: ${row.text}`);
      for (const token of row.tokens) {
        const end = Math.min(token.endIndex, row.text.length);
        chunks.push(`  [${token.startIndex},${end}) ${JSON.stringify(row.text.slice(token.startIndex, end))} => ${token.scopes.join(' ')}`);
      }
    }
    chunks.push('');
    const directory = path.join(root, 'test/output/tokens');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${path.basename(file)}.txt`), chunks.slice(start).join('\n') + '\n');
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, chunks.join('\n') + '\n');
  console.log(`Wrote first 40 lines (or entire shorter file) of all nine sample fixtures to ${output}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
