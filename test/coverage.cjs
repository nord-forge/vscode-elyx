const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { root, fixtures, loadGrammar, tokenize } = require('./lib/grammar.cjs');

// Only language meanings count. source.*, meta.*, and arbitrary blanket scopes
// cannot make a token pass this audit; invalid tokens also fail known-good files.
const meaningful = /^(comment\.line\.double-slash|constant\.(numeric|other\.color\.rgb-value\.hex|language\.atom|character\.escape)|keyword\.(operator|control|other\.unit)|storage\.(modifier|type\.kind)|entity\.name\.(type|tag|function\.decorator)|variable\.(other|parameter|language\.file)|support\.(function|type\.property-name)|punctuation\.)/;
function meaningfulToken(token, text) {
  const scopes = token.scopes;
  if (scopes.some(s => s.startsWith('invalid.'))) return false;
  if (scopes.some(s => s.startsWith('string.quoted.double.') || s.startsWith('comment.line.double-slash.'))) return true;
  const scope = scopes.at(-1);
  if (!meaningful.test(scope)) return false;
  // An identifier catch-all over an entire line is not language coverage.
  if (/^(variable\.|entity\.name\.|support\.)/.test(scope)) return /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(text);
  if (scope.startsWith('constant.numeric.')) return /^[+-]?\d+(?:\.\d+)?$/.test(text);
  if (scope.startsWith('constant.other.color.')) return /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(text);
  if (scope.startsWith('constant.language.atom.')) return /^\.[A-Za-z_-][A-Za-z0-9_-]*$/.test(text);
  if (scope.startsWith('keyword.operator.')) return /^[+*/'-]$/.test(text);
  if (scope.startsWith('keyword.other.unit.')) return /^(?:%|[A-Za-z_-][A-Za-z0-9_-]*)$/.test(text);
  if (/^(keyword\.control\.|storage\.)/.test(scope)) return /^[A-Za-z_][A-Za-z_-]*$/.test(text);
  if (scope.startsWith('punctuation.')) return /^(?:::|[\[\](){}:=,.@])$/.test(text);
  return false;
}
async function main() {
  const grammar = await loadGrammar();
  const results = [];
  const failures = [];
  for (const file of fixtures()) {
    const start = performance.now();
    const rows = tokenize(grammar, file);
    const elapsedMs = performance.now() - start;
    let nonWhitespace = 0, onlySource = 0, unclassified = 0, codeUnits = 0;
    for (const row of rows) {
      let cursor = 0;
      for (const token of row.tokens) {
        const end = Math.min(token.endIndex, row.text.length);
        if (token.startIndex > row.text.length) continue;
        assert.equal(token.startIndex, cursor, `${file}:${row.number}: token gap or overlap at ${cursor}`);
        assert(end >= token.startIndex, `${file}:${row.number}: backwards token`);
        cursor = end;
        for (let i = token.startIndex; i < end; i++) {
          codeUnits++;
          if (/\s/u.test(row.text[i])) continue;
          nonWhitespace++;
          if (token.scopes.every(s => s === 'source.elyx')) onlySource++;
          const semantic = meaningfulToken(token, row.text.slice(token.startIndex, end));
          if (!semantic) {
            unclassified++;
            if (failures.length < 50) failures.push(`${file}:${row.number}:${i + 1} ${JSON.stringify(row.text[i])}: ${token.scopes.join(' ')}`);
          }
        }
      }
      assert.equal(cursor, row.text.length, `${file}:${row.number}: end of line not tokenized`);
    }
    const result = { file, lines: rows.length, codeUnits, nonWhitespace, onlySource, unclassified, elapsedMs: +elapsedMs.toFixed(2) };
    results.push(result);
    console.log(`${file}: ${nonWhitespace} nonwhitespace characters; source-only=${onlySource}; unclassified=${unclassified}; ${result.elapsedMs}ms`);
    if (file.endsWith('/index.elyx')) assert(elapsedMs < 2000, `index.elyx tokenization took ${elapsedMs.toFixed(2)}ms (limit 2000ms)`);
  }
  fs.mkdirSync(path.join(root, 'test/output'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test/output/coverage.json'), JSON.stringify(results, null, 2) + '\n');
  assert.equal(results.length, 9, 'Expected all nine sample fixtures');
  assert.equal(results.reduce((n,r) => n + r.onlySource + r.unclassified, 0), 0, `Unscoped or blanket-only fixture content:\n${failures.join('\n')}`);
  console.log('Every character of every fixture line tokenized; all nonwhitespace has a meaningful language scope.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
