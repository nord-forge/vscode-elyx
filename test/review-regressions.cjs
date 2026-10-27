// Independent review regressions. Validity checked with Elyx Preview diagnostics;
// ABNF-only expression map keys are out of scope here, not blockers.
const assert = require('node:assert/strict');
const { loadGrammar, tokenize } = require('./lib/grammar.cjs');
async function main() {
  const grammar = await loadGrammar();
  const rows = tokenize(grammar, 'test/cases/review-regressions.elyx');
  let checks = 0;
  const failures = [];
  const variable = /^variable\.other\.elyx$/;
  const operator = /^keyword\.operator\.arithmetic\.elyx$/;
  const property = /^support\.type\.property-name\.elyx$/;
  const tag = /^entity\.name\.tag\.elyx$/;
  const numeric = /^constant\.numeric\.elyx$/;
  function check(needle, tokenText, expected, forbidden, occurrence = 0, sourceRows = rows) {
    checks++;
    const row = typeof needle === 'number' ? sourceRows[needle - 1] : sourceRows.find(r => r.text.includes(needle));
    assert(row, `Bad review test: missing row ${needle}`);
    let start = -1;
    for(let i=0;i<=occurrence;i++) start = row.text.indexOf(tokenText, start + 1);
    assert(start>=0, `Bad review test: missing ${tokenText} in ${row.text}`);
    for(let p=start;p<start+tokenText.length;p++) {
      const t=row.tokens.find(t=>t.startIndex<=p && t.endIndex>p);
      if(!t || !t.scopes.some(s=>expected.test(s)) || (forbidden && t.scopes.some(s=>forbidden.test(s)))) {
        failures.push(`${row.number}:${p+1} ${JSON.stringify(tokenText)} expected ${expected}${forbidden ? ` forbidden ${forbidden}` : ''}; actual ${t?.scopes.join(' ')}`);
        break;
      }
    }
  }
  for(const [row, text] of [['leading-hyphen:', '-name'],['single-hyphen:', '-'],['repeated-hyphen:', '--name']]) {
    // Start after ':' to avoid selecting the property key's own hyphen.
    const r=rows.find(r=>r.text.includes(row));
    const value=r.text.slice(r.text.indexOf(':')+1).trim().replace(/,$/,'');
    assert.equal(value,text);
    check(r.number,text,variable,/^keyword\./, text==='-' ? 1 : 0);
  }
  for(const [needle,text,n] of [['names:', '-name',0],['names:', '-name',1],['names:', '--',0],['arguments:', '-name',0],['arguments:', '-name',1],['group:', '-name',0]]) check(needle,text,variable,/^keyword\./,n);
  for(const [needle,op] of [['addition:', '+'],['subtraction:', '-']]) {
    check(needle,op,operator,numeric);
    check(needle,'2',numeric,operator);
  }
  check('signed:', '-2',numeric,operator);
  check('signed:', '+2',numeric,operator);
  for(const [needle,op] of [['symbolicPlus:', '+'],['symbolicMinus:', '-'],['symbolicOperand:', '-'],['groupedPlus:', '+'],['symbolicPlusOperand:', '+']]) check(needle,op,operator,/^(constant\.numeric\.|variable\.)/);
  for(const needle of ['symbolicOperand:','symbolicPlusOperand:']) check(needle,'bar',variable,operator);
  for(const needle of ['multipliedNegative:','addedNegative:']) check(needle,'-2',numeric,operator);
  check('subtractedNegative:','-2',numeric,operator);
  check('subtractedNegative:','-',operator,numeric);
  check('negativeLength:','-0.5',numeric,operator);
  check('negativeLength:','px',/^keyword\.other\.unit\.elyx$/);
  check('negativeNamedOperand:','-bar',variable,operator);
  for(const [needle,occurrence] of [['hyphenPath:',0],['hyphenPathList:',0],['hyphenPathList:',1]]) {
    check(needle,'-foo',variable,operator,occurrence);
    check(needle,'.',/^punctuation\.separator\.accessor\.elyx$/,undefined,occurrence);
    check(needle,'bar',variable,operator,occurrence);
  }
  check('bareHyphenPath:','-',variable,operator);
  check('bareHyphenPath:','.',/^punctuation\.separator\.accessor\.elyx$/);
  check('bareHyphenPath:','value',variable);
  for(const op of ['+','-','*','/']) {
    const row=rows.find(r=>r.text.startsWith(op+' 2)'));
    assert(row, 'Missing newline arithmetic case '+op);
    check(row.number,op,operator,/^variable\./);
    check(row.number,'2',numeric,operator);
  }
  for(const text of ['file','children','frame','import','if']) check(`  ${text} {}`,text,tag,/^(keyword\.|storage\.|variable\.language\.file\.)/);
  check('::children {}','children',tag,/^keyword\./);
  check('label.children {}','label',tag);
  check('label.children {}','children',tag,/^keyword\./);
  for(const text of ['fill','frame','color']) check('::fill[0]',text,property,/^storage\./);
  check('::fill[0]','0',numeric);
  check('::fill[0]','2',numeric);
  check('file-call:','file',/^support\.function\.elyx$/, /^variable\.language\.file\./,1);
  check('file-call:','file',variable,/^variable\.language\.file\./,2);
  check('file-call:','file',/^variable\.parameter\.function\.elyx$/, /^variable\.language\.file\./,3);
  check('file-call:','file',variable,/^variable\.language\.file\./,4);
  check('file { draw-connections:','file',/^variable\.language\.file\.elyx$/);
  check('file = frame','file',/^variable\.other\.definition\.elyx$/, /^variable\.language\.file\./);
  check('file = frame','file',property,/^variable\.language\.file\./,1);
  check('file = frame','file',variable,/^variable\.language\.file\./,2);
  for(const text of ['key','nested','color']) check('  map:',text,property);
  check('  map:','stop',/^support\.function\.elyx$/);
  check('  map:','.transparent',/^constant\.language\.atom\.elyx$/);
  check('@context','if',/^variable\.parameter\.function\.elyx$/,/^keyword\./);
  check('@context','frame',variable,/^storage\./);
  check('@context','if',variable,/^keyword\./,1);
  check('@context','✓',/^string\.quoted\.double\.elyx$/);
  for(const text of ['theme','frame']) check('export sourced',text,/^entity\.name\.type\.source\.elyx$/,/^(keyword\.|storage\.)/,text==='frame' ? 1 : 0);
  check('import "colors.elyx"','colors',variable,undefined,1);
  check('@context(theme="dark")','@',/^punctuation\.definition\.annotation\.elyx$/);
  check('@context(theme="dark")','context',/^entity\.name\.function\.decorator\.elyx$/);
  check('@variant','variant',/^entity\.name\.function\.decorator\.elyx$/);
  check('export following','following',/^variable\.other\.definition\.elyx$/);
  for(const [fixture,annotation] of [['colors.dark','context'],['nightHike','with-context']]) {
    const realRows=tokenize(grammar,`test/fixtures/${fixture}.elyx`);
    check(`@${annotation}`, '@', /^punctuation\.definition\.annotation\.elyx$/,undefined,0,realRows);
    check(`@${annotation}`,annotation,/^entity\.name\.function\.decorator\.elyx$/,undefined,0,realRows);
    check('file {}','file',/^variable\.language\.file\.elyx$/,undefined,0,realRows);
  }
  const darkRows=tokenize(grammar,'test/fixtures/colors.dark.elyx');
  check('export darkTheme','darkTheme',/^variable\.other\.definition\.elyx$/,undefined,0,darkRows);
  check('export darkTheme','colors',/^entity\.name\.type\.source\.elyx$/,undefined,0,darkRows);
  if(failures.length) throw new Error(`${failures.length}/${checks} independent review assertions failed:\n${failures.join('\n')}`);
  console.log(`${checks} independent review assertions passed.`);
}
if(require.main===module) main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={ main };
