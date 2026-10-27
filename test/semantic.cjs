// Expected meanings come from docs/LANGUAGE.md, not generated tokens.
const assert = require('node:assert/strict');
const { loadGrammar, tokenize } = require('./lib/grammar.cjs');

async function main() {
  const grammar = await loadGrammar();
  const cache = new Map();
  const failures = [];
  let checks = 0;
  function scope(file, line, text, expected, occurrence = 0, forbidden) {
    checks++;
    if (!cache.has(file)) cache.set(file, tokenize(grammar, `test/cases/${file}.elyx`));
    const row = cache.get(file)[line - 1];
    let start = -1;
    for (let n = 0; n <= occurrence; n++) start = row.text.indexOf(text, start + 1);
    assert(start >= 0, `Bad test: ${file}:${line} missing ${JSON.stringify(text)}`);
    for (let p = start; p < start + text.length; p++) {
      const token = row.tokens.find(t => t.startIndex <= p && t.endIndex > p);
      if (!token || (expected && !token.scopes.some(s => expected.test(s))) || (forbidden && token.scopes.some(s => forbidden.test(s)))) {
        failures.push(`${file}:${line}:${p + 1} ${JSON.stringify(text)} expected ${expected || 'no forbidden scope'}${forbidden ? `; forbidden ${forbidden}` : ''}; actual ${token?.scopes.join(' ') || '<gap>'}`);
        break;
      }
    }
  }
  const numeric = /^constant\.numeric\./;
  const unit = /^keyword\.other\.unit\./;
  const variable = /^variable\./;
  const definition = /^(entity\.name\.type\.(?!source)|variable\.other\.definition\.)/;
  const property = /^support\.type\.property-name\./;
  const atom = /^constant\.language\.atom\./;
  const string = /^string\.quoted\.double\./;
  const punctuation = /^punctuation\./;
  const color = /^constant\.other\.color\.rgb-value\.hex\./;
  const kind = /^storage\.type\.kind\./;
  const source = /^entity\.name\.type\.source\./;
  const decorator = /^entity\.name\.function\.decorator\./;
  const keyword = /^(keyword\.|storage\.modifier\.)/;
  scope('comments', 1, '// Only line comments', /^comment\.line\.double-slash\./);
  scope('hyphenated-names', 1, 'brand-blue', definition);
  scope('hyphenated-names', 2, 'x2-5', property);
  scope('hyphenated-names', 3, 'brand-blue', variable);
  scope('hyphenated-names', 3, 'x2-5', variable);
  for (const text of ['_private', '-dash']) {
    scope('hyphenated-names', 4, text, property);
    scope('hyphenated-names', 5, text, variable);
  }
  for (const text of ['-12', '+3', '0.5', '16']) scope('numbers-lengths-colors', 2, text, numeric, 0, /^(keyword\.other\.unit|constant\.other\.color)\./);
  for (const [number, suffix] of [['16','px'],['50','%'],['180','deg'],['12','pt'],['2','widgets'],['-0.5','px'],['+3','pt']]) {
    scope('numbers-lengths-colors', 3, number, numeric);
    scope('numbers-lengths-colors', 3, suffix, unit, suffix === 'px' && number === '-0.5' ? 1 : suffix === 'pt' && number === '+3' ? 1 : 0, /^constant\.other\.color\./);
  }
  for (const text of ['#abc', '#abcd', '#2f6f8f', '#ffffff08']) scope('numbers-lengths-colors', 4, text, color, 0, /^(constant\.numeric|keyword\.other\.unit)\./);
  for (const text of ['#abcde', '#abcdef0']) scope('invalid-hex', 1, text, null, 0, color);
  for (const text of ['true','false','nil','center','column','space-between','gaussian-blur','transparent','white']) scope('atoms-vs-qualified', 2, text, atom);
  for (const text of ['colors','palette','royalBlue']) scope('atoms-vs-qualified', 3, text, variable);
  scope('atoms-vs-qualified', 3, '::', punctuation);
  for (const op of ['+', '-', '*', '/']) scope('operators', 1, op, /^keyword\.operator\.arithmetic\./);
  scope('quote-operator', 1, "'", /^keyword\.operator\.quote\./, 0, string);
  scope('quote-operator', 1, 'colors', variable);
  scope('strings-escapes-unicode', 2, '› ✓ 😀 café', string);
  for (const text of ['\\n','\\r','\\t','\\"','\\\\']) scope('strings-escapes-unicode', 2, text, /^constant\.character\.escape\./);
  scope('comments', 3, 'https://example.test/a//b', string, 0, /^comment\./);
  scope('comments', 3, '// trailing comment', /^comment\.line\.double-slash\./);
  scope('comments', 4, '// another trailing comment', /^comment\.line\.double-slash\./);
  for (const [line, word] of [[1,'use'],[2,'import'],[2,'as'],[3,'priv'],[4,'export']]) scope('modules', line, word, keyword);
  scope('modules', 1, 'public/fonts/Druk-Bold-Web.woff2', string);
  scope('modules', 2, 'colors', variable, 1);
  scope('modules', 3, 'local', definition);
  scope('modules', 4, 'public-name', definition);
  scope('token-instances', 1, 'palette', definition);
  scope('token-instances', 1, 'tokens', kind);
  scope('token-instances', 1, 'brandBlue', property);
  scope('token-instances', 2, 'darkTheme', definition);
  scope('token-instances', 2, 'tokens', kind);
  scope('token-instances', 2, 'colors', source);
  scope('token-instances', 2, 'theme', source);
  scope('token-instances', 2, 'page', property);
  for (const [index, word] of ['frame','boolean','tokens','text','shape','asset','icon'].entries()) scope('kinds', index + 1, word, kind);
  const reserved = [
    'board component group __board__ __document__ let const fn this self',
    'children where type trait super struct static ref mod loop in data',
    'async await if when then else match case not and or try catch rescue',
    'finally throw return __file__ __canvas__',
  ];
  reserved.forEach((line, index) => line.split(' ').forEach(word => scope('reserved', index + 1, word, /^(keyword\.|invalid\.illegal\.|variable\.language\.)/)));
  scope('contextual-file', 1, 'file', /^variable\.language\.file\./);
  scope('contextual-file', 2, 'file', definition, 0, /^variable\.language\.file\./);
  scope('contextual-file', 3, 'file', variable, 0, /^variable\.language\.file\./);
  scope('contextual-file', 3, 'file', property, 1, /^variable\.language\.file\./);
  scope('contextual-file', 3, 'file', variable, 2, /^variable\.language\.file\./);
  // An isolated name is ambiguous until the later block delimiter. Verify its name
  // role and metadata contents; TextMate cannot recolor preceding lines afterward.
  scope('contextual-file', 4, 'file', variable);
  scope('contextual-file', 6, 'draw-connections', property);
  for (const [line, word] of [[1,'variant'],[3,'context'],[5,'context'],[7,'with-context'],[9,'with-context'],[11,'with-context'],[13,'with-variant'],[15,'use-variant'],[17,'with-context']]) scope('annotations', line, word, decorator);
  for (const line of [3,5,7,17]) scope('annotations', line, 'theme', /^(variable\.parameter\.|support\.type\.property-name\.)/);
  scope('annotations', 3, 'dark', string);
  scope('annotations', 5, 'dark', variable);
  scope('annotations', 13, 'sidebarItemActive', variable);
  scope('annotations', 17, '::', punctuation);
  scope('annotations', 17, '=', punctuation);
  scope('three-shapes', 1, 'button', definition);
  scope('three-shapes', 2, 'fill', property);
  scope('three-shapes', 2, '0', numeric);
  scope('three-shapes', 2, 'color', property);
  scope('three-shapes', 3, 'label', definition);
  scope('three-shapes', 3, 'text', kind);
  scope('three-shapes', 3, 'typography', source);
  scope('three-shapes', 3, 'base', source);
  scope('three-shapes', 6, 'label', /^entity\.name\.tag\./);
  for (const text of ['shadow','inner-shadow','blur-radius']) scope('root-indexed-paths', 2, text, property);
  scope('root-indexed-paths', 2, '1', numeric);
  scope('root-indexed-paths', 3, '::', punctuation);
  scope('root-indexed-paths', 3, 'fill', property);
  for (const name of ['point','stop','rgb','rgba','hsl','oklch','opacity']) scope('functions', 2, name, /^support\.function\./);
  for (const name of ['insert','remove','move','set','unset']) scope('functions', 3, name, /^support\.function\./);
  scope('functions', 3, 'target', /^support\.function\./, 1);
  scope('functions', 3, 'after', /^(variable\.parameter\.|support\.type\.property-name\.)/);
  scope('functions', 3, '=', punctuation);
  scope('functions', 3, 'nil', atom);
  scope('functions', 4, 'custom-function', /^support\.function\./);
  scope('functions', 4, 'named-arg', /^(variable\.parameter\.|support\.type\.property-name\.)/);
  scope('nested-containers', 4, 'nested', property);
  scope('nested-containers', 7, 'color', property);
  scope('nested-containers', 8, 'stop', /^support\.function\./);
  scope('nested-containers', 9, 'transparent', atom);
  scope('nested-containers', 14, 'padding', property);
  scope('nested-containers', 15, 'child', definition);
  scope('nested-containers', 16, 'still a string after containers', string);
  scope('multiline-declaration', 1, 'export', keyword);
  scope('multiline-declaration', 3, 'multiline-name', variable);
  scope('multiline-declaration', 5, '=', punctuation);
  scope('multiline-declaration', 7, 'frame', kind);
  scope('multiline-declaration', 9, ':', punctuation);
  scope('multiline-declaration', 11, 'typography', source);
  scope('multiline-declaration', 11, 'base', source);
  scope('multiline-declaration', 13, '{', punctuation);
  scope('multiline-declaration', 14, 'contents', property);
  scope('multiline-declaration', 15, 'child', variable);
  scope('multiline-declaration', 18, 'text', kind);
  scope('multiline-declaration', 20, 'typography', source);
  scope('multiline-declaration', 22, 'fill', property);
  if (failures.length) throw new Error(`${failures.length}/${checks} semantic assertions failed:\n${failures.join('\n')}`);
  console.log(`${checks} semantic assertions passed across ${cache.size} specification cases.`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
