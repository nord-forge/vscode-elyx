# Elyx for Zed

This is a companion extension for Zed. It includes a structural Tree-sitter parser, generated C sources, highlighting queries, comments, bracket pairing, indentation and an outline for declarations and overrides. The parser derives from the Elyx ABNF (`elyx man abnf`, summarised in [the language notes](../docs/LANGUAGE.md)) and the sample design fixtures in `../test/fixtures`.

From this directory, run:

```sh
bun install --frozen-lockfile
bun run generate
bun run test
```

The pinned Tree-sitter CLI compiles a native parser for tests. A C compiler must be available. Test output, parse timings, the positive syntax tree and highlight captures are saved in `artifacts/`. Generated `src/parser.c`, `src/grammar.json`, `src/node-types.json` and Tree-sitter headers belong in Git alongside `src/scanner.c`. Generation targets language ABI 14 for compatibility.

After committing the current grammar, generated sources and language queries locally, run:

```sh
bun run prepare:local
```

This creates ignored `extension.toml` with the actual checkout's `file://` URL, its current full Git HEAD and grammar path `zed`. It refuses an uncommitted grammar or a HEAD that does not contain the generated parser. In Zed, use `zed: install dev extension` and select this `zed` directory. Rerun the preparation command after moving the checkout or committing grammar changes.

The manifest is generated for this checkout only. Nothing is uploaded or published. No remote repository is assumed. Zed's language guide explicitly supports [local grammar repository URLs](https://zed.dev/docs/extensions/languages#grammar); its [manifest definition](https://github.com/zed-industries/zed/blob/main/crates/extension/src/extension_manifest.rs) supports the relative grammar `path` used for this monorepo.

## Configuration

Zed extensions cannot add their own settings, so Elyx uses Zed's standard ones.

Editor behaviour for `.elyx` files goes under `languages`. The extension sets
`tab_size` to 2 and `//` line comments. Anything set here wins:

```json
{
  "languages": {
    "Elyx": {"tab_size": 4, "hard_tabs": false, "format_on_save": "off"}
  }
}
```

Syntax colours come from your Zed theme. Override them per theme with
`theme_overrides`. The capture names are shared with every other language, so a
change to `property` also changes JSON keys and CSS properties in that theme.

```json
{
  "theme_overrides": {
    "One Dark": {
      "syntax": {
        "type": {"color": "#c678dd"},
        "constant.builtin": {"font_style": "italic"}
      }
    }
  }
}
```

| Elyx syntax | Capture |
| --- | --- |
| Comments | `comment` |
| Strings and escapes | `string`, `string.escape` |
| Numbers and list indexes | `number` |
| Length units | `type.builtin` |
| Hex colours and atoms | `constant`, `constant.builtin` |
| Kinds such as `frame` and `tokens` | `type.builtin` |
| Declaration names and source types | `type` |
| `import`, `use`, `as` and access modifiers | `keyword` |
| Annotations | `attribute` |
| Property and map keys | `property` |
| Override names | `tag` |
| Function calls and named arguments | `function`, `variable.parameter` |
| References | `variable` |
| `file` metadata | `variable.special` |
| Operators and punctuation | `operator`, `punctuation.bracket`, `punctuation.delimiter`, `punctuation.special` |

Colour swatches and visual hovers are VS Code only for now. Zed needs a
language server for them.

Tests parse all nine sample fixtures without error or missing nodes, inspect actual declaration/property/override and nested expression nodes, reject invalid hex lengths without partial color captures, reject reserved declaration and expression names, and validate all five Zed query files. Additional cases cover contextual `file`, legal reserved raw keys and members, annotations, escapes, Unicode, arithmetic whitespace and immediate function-call openers. The external scanner preserves whole identifiers and enforces the lexical boundaries that Tree-sitter regexes cannot express with lookahead.

The current Elyx CLI accepts multiline arguments but rejects whitespace, comments or newlines between a function name and its opening parenthesis. This was checked with the bundled formatter and is reflected in the tests. Its prose also describes reserved map keys broadly, although the current CLI rejects `import` as a map key while accepting `children` and `frame`; this syntax grammar follows the report's raw-key model. It does not replace Elyx semantic diagnostics.

Tested in Zed 1.25.3 on macOS. Install dev extension compiled the grammar to Wasm without errors, and `.elyx` files open as Elyx with highlighting and no query errors in the log. In a separate profile, the `theme_overrides` example above recoloured property keys and made `type.builtin` italic. A `languages.Elyx` entry turned on `show_whitespaces`. Outline, bracket and indent behaviour were not checked by hand.
