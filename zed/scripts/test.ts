import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { localManifest } from "./prepare-local";

const root = resolve(import.meta.dir, "..");
process.chdir(root);
// Call the native binary. A copied .bin wrapper can end up starting itself.
const cli = resolve(root, "node_modules/tree-sitter-cli/tree-sitter");
const logs: string[] = [];
function run(args: string[], expectedSuccess = true) {
  const result = spawnSync(cli, args, { encoding: "utf8" });
  logs.push(`$ tree-sitter ${args.join(" ")}\n${result.stdout}${result.stderr}\nexit: ${result.status}\n`);
  if (result.error) throw result.error;
  assert.equal(result.status === 0, expectedSuccess, result.stdout + result.stderr);
  return result.stdout;
}

mkdirSync("artifacts", { recursive: true });
try {
  const generated = ["src/parser.c", "src/grammar.json", "src/node-types.json"];
  const before = generated.map(file => readFileSync(file, "utf8"));
  run(["generate", "--abi", "14"]);
  generated.forEach((file, index) => assert.equal(readFileSync(file, "utf8"), before[index], `${file} must be regenerated`));

  const fixtures = readdirSync("../test/fixtures").filter(file => file.endsWith(".elyx")).sort().map(file => `../test/fixtures/${file}`);
  assert.equal(fixtures.length, 9);
  const positiveFiles = [...fixtures, "test/positive.elyx", "test/roles.elyx"];
  const summary = JSON.parse(run(["parse", "--json", ...positiveFiles]));
  assert.equal(summary.parse_summaries.length, 11);
  assert(summary.parse_summaries.every((item: any) => item.successful));
  writeFileSync("artifacts/parse-results.json", JSON.stringify(summary, null, 2) + "\n");

  const structure = run(["parse", "test/positive.elyx"]);
  for (const node of ["import_declaration", "use_declaration", "file_metadata", "declaration", "typed_block", "property", "property_path", "frame_override", "override", "map_entry", "list", "call_expression", "named_argument", "binary_expression", "quote_expression", "annotation", "hex_color", "length", "escape_sequence"]) {
    assert(structure.includes(`(${node} `), `Missing structural node ${node}`);
  }
  writeFileSync("artifacts/positive-tree.txt", structure);

  for (const value of ["#1", "#12", "#12345", "#1234567", "#123456789", "#1234567890", "#xyz", "#fffggg"]) {
    const file = "artifacts/invalid.elyx";
    writeFileSync(file, `palette = tokens {color: ${value}}\n`);
    run(["parse", "--quiet", file], false);
    const captures = run(["query", "languages/elyx/highlights.scm", file, "--captures"]);
    assert(!captures.includes(" - constant,"), `${value} must not receive a partial color highlight`);
  }

  const reservedWords = ['import', 'use', 'export', 'priv', 'as', 'frame', 'text', 'boolean', 'shape', 'asset', 'tokens', 'icon', 'board', 'component', 'group', '__board__', '__document__', '__file__', '__canvas__', 'let', 'const', 'fn', 'this', 'self', 'children', 'where', 'type', 'trait', 'super', 'struct', 'static', 'ref', 'mod', 'loop', 'in', 'data', 'async', 'await', 'if', 'when', 'then', 'else', 'match', 'case', 'not', 'and', 'or', 'try', 'catch', 'rescue', 'finally', 'throw', 'return'];
  for (const word of reservedWords) {
    for (const source of [`${word} = frame {}`, `a = tokens {x: ${word}}`, `a = tokens {x: ::${word}}`]) {
      writeFileSync("artifacts/invalid.elyx", source);
      run(["parse", "--quiet", "artifacts/invalid.elyx"], false);
    }
  }
  for (const source of ['a = tokens {x: 1+2}', 'a = tokens {x: 2*3}', 'a = tokens {x: 4/2}', 'a = tokens {x: :: name}', 'a = tokens {x: rgb (1, 2, 3)}', 'a = tokens {x: rgb\n(1, 2, 3)}', 'a = tokens {x: rgb //comment\n(1, 2, 3)}', 'priv a = frame {}']) {
    writeFileSync("artifacts/invalid.elyx", source);
    run(["parse", "--quiet", "artifacts/invalid.elyx"], false);
  }
  // Also reject unterminated strings and unmatched delimiters.
  for (const text of ['a = text {contents: "unterminated}', 'a = frame {padding: [1, 2}', 'a = tokens {x: #fff']) {
    writeFileSync("artifacts/invalid.elyx", text);
    run(["parse", "--quiet", "artifacts/invalid.elyx"], false);
  }

  for (const query of readdirSync("languages/elyx").filter(file => file.endsWith(".scm"))) {
    run(["query", `languages/elyx/${query}`, ...positiveFiles, "--quiet"]);
  }
  const captures = run(["query", "languages/elyx/highlights.scm", "test/positive.elyx", "--captures"]);
  for (const capture of ["comment", "string", "string.escape", "number", "constant", "constant.builtin", "type.builtin", "type", "property", "function", "attribute", "tag", "keyword", "variable.special", "operator", "punctuation.bracket", "punctuation.delimiter", "punctuation.special"]) {
    assert(new RegExp(` - ${capture.replaceAll(".", "\\.")},`).test(captures), `Missing highlight capture ${capture}`);
  }
  writeFileSync("artifacts/highlight-captures.txt", captures);
  const roleCaptures = run(["query", "languages/elyx/highlights.scm", "test/roles.elyx", "--captures"]);
  writeFileSync("artifacts/role-captures.txt", roleCaptures);
  const records = roleCaptures.split("\n").flatMap(line => {
    const match = line.match(/ - ([\w.]+), start: \((\d+), (\d+)\), end: \((\d+), (\d+)\), text: `(.*)`/);
    return match ? [{ capture: match[1], row: +match[2], column: +match[3], text: match[6] }] : [];
  });
  for (const [row, column, text, role] of [[0, 0, "file", "variable.special"], [1, 0, "file", "type"], [1, 14, "children", "property"], [2, 1, "context", "attribute"], [2, 9, "children", "variable.parameter"], [2, 18, "frame", "variable"], [3, 15, "base", "type"], [3, 20, "frame", "type"], [4, 2, "children", "tag"], [5, 11, "children", "property"], [5, 28, "frame", "property"]] as const) {
    const found = records.filter(record => record.row === row && record.column === column && record.text === text);
    assert(found.some(record => record.capture === role), `Missing ${role} on ${text} at ${row}:${column}`);
    assert(!found.some(record => record.capture === "keyword"), `Legal raw name ${text} incorrectly captured as keyword`);
  }
  writeFileSync("artifacts/reserved.elyx", "board = frame {}\n");
  const reservedCapture = run(["query", "languages/elyx/highlights.scm", "artifacts/reserved.elyx", "--captures"]);
  assert(reservedCapture.includes(" - keyword,") && reservedCapture.includes("text: `board`"), "Rejected whole reserved names must retain keyword highlights");
  const manifest = Bun.TOML.parse(localManifest("/tmp/a checkout", "a".repeat(40))) as any;
  assert.equal(manifest.grammars.elyx.repository, "file:///tmp/a%20checkout");
  assert.equal(manifest.grammars.elyx.path, "zed");
  assert.equal(manifest.grammars.elyx.rev, "a".repeat(40));
  assert.throws(() => localManifest("/tmp/test", "HEAD"));
  const config = Bun.TOML.parse(readFileSync("languages/elyx/config.toml", "utf8")) as any;
  assert.equal(config.grammar, "elyx");
  assert.deepEqual(config.path_suffixes, ["elyx"]);
  assert.equal(config.brackets.length, 4);
  logs.push(`PASS: 9 sample fixtures, 2 positive fixtures, 19 invalid lexical cases, ${reservedWords.length * 3} reserved-name cases, 5 query files, structural assertions, highlight categories and exact role checks, language config and local manifest builder.\n`);
  console.log(logs.at(-1));
} finally {
  writeFileSync("artifacts/test.log", logs.join("\n"));
}
