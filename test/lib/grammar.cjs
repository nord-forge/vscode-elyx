const fs = require('node:fs');
const path = require('node:path');
const tm = require('vscode-textmate');
const onig = require('vscode-oniguruma');

const root = path.resolve(__dirname, '../..');
const fixtures = () => fs.readdirSync(path.join(root, 'test/fixtures')).filter(f => f.endsWith('.elyx')).sort().map(f => `test/fixtures/${f}`);
const cases = () => fs.readdirSync(path.join(root, 'test/cases')).filter(f => f.endsWith('.elyx')).sort().map(f => `test/cases/${f}`);
async function loadGrammar() {
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await onig.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const registry = new tm.Registry({
    onigLib: Promise.resolve({ createOnigScanner: p => new onig.OnigScanner(p), createOnigString: s => new onig.OnigString(s) }),
    loadGrammar: async scope => scope === 'source.elyx'
      ? tm.parseRawGrammar(fs.readFileSync(path.join(root, 'syntaxes/elyx.tmLanguage.json'), 'utf8'), 'elyx.tmLanguage.json')
      : null,
  });
  return registry.loadGrammar('source.elyx');
}
function tokenize(grammar, relative) {
  const lines = fs.readFileSync(path.join(root, relative), 'utf8').split(/\r\n|\r|\n/);
  let state = tm.INITIAL;
  return lines.map((text, index) => {
    const result = grammar.tokenizeLine(text, state);
    state = result.ruleStack;
    return { number: index + 1, text, tokens: result.tokens };
  });
}
module.exports = { root, fixtures, cases, loadGrammar, tokenize };
