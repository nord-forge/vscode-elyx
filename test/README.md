# Grammar checks

Run these from the extension root with Bun:

```sh
bun run test:semantic
bun run test:snapshots
bun run test:coverage
bun run test:tokens
bun run test:diagnostics
```

`bun run test` runs semantic assertions, committed snapshot comparisons, and
complete sample-fixture coverage. `bun run test:snapshots:update` first requires
the independent semantic assertions to pass, then invokes
`vscode-tmgrammar-snap --updateSnapshot`. The `vscode-tmgrammar-test` package
provides that binary. Review snapshot changes before accepting them. Ordinary
snapshot checks fail if a snapshot is absent, avoiding the library's automatic
generation behavior during verification.

The cases are authored from `docs/LANGUAGE.md`, separately from
the grammar. Assertions check specific meanings and incompatible scopes, rather
than merely requiring a token to have some scope.

| Rule or edge | Case |
| --- | --- |
| Symbols, hyphens, underscore and dash starts | `hyphenated-names.elyx` |
| Signed numbers, fractional values, lengths, arbitrary units, valid hex lengths | `numbers-lengths-colors.elyx` |
| Five- and seven-digit hex must have no color scope, even partially | `invalid-hex.elyx` |
| Atoms and ordinary/absolute qualified references | `atoms-vs-qualified.elyx` |
| Double-quoted Unicode and every supported escape | `strings-escapes-unicode.elyx` |
| Quote operator distinguished from strings | `quote-operator.elyx` |
| Line and trailing comments, URL and `//` inside strings | `comments.elyx` |
| Four whitespace-prefixed arithmetic operators and grouping | `operators.elyx` |
| Import, alias, font use, access modifiers | `modules.elyx` |
| Every current and legacy kind | `kinds.elyx` |
| Every reserved word and app tokenizer reserved name | `reserved.elyx` |
| Contextual metadata `file`, ordinary declaration/property/value `file` | `contextual-file.elyx` |
| Every documented annotation spelling and argument form | `annotations.elyx` |
| Declaration, property, override and typed source roles | `three-shapes.elyx` |
| Absolute property keys, indexes and hyphenated path segments | `root-indexed-paths.elyx` |
| Token groups and token instances | `token-instances.elyx` |
| All practical built-ins, custom calls and named function arguments | `functions.elyx` |
| Multiline nested maps, lists, calls and declarations | `nested-containers.elyx` |
| Names, `=`, kind, `:`, source, `{` separated by whitespace and comments | `multiline-declaration.elyx` |

TextMate tokenizes one line at a time. An isolated name whose `=`, `:` or `{`
occurs on a later line cannot be classified retroactively as a declaration,
property, override, or metadata name. Such tests require a variable scope on the
ambiguous name, then precise kind/source/property roles after the discriminator.
Same-line tests require the precise name roles.

`test/fixtures/*.elyx` are a sample design project written for these tests:
Brambleway, an invented trail planner with hut bookings. The nine files are a
light palette (`colors.elyx`), a dark theme that derives from it under a
`theme=dark` context (`colors.dark.elyx`), spacing, radius and type tokens
(`foundations.elyx`), text styles (`text.elyx`), a component library
(`components.elyx`), decorative gradients (`backgrounds.elyx`), a daylight
screen (`trailGuide.elyx`), a night screen that applies the dark context
(`nightHike.elyx`) and a large overview board with connections between the
screens (`index.elyx`). Their imports resolve among themselves. Every fixture and every case has a `.snap` generated with
`vscode-tmgrammar-snap`. `coverage.cjs` checks contiguous token ranges across
every character of every fixture line, including whitespace, and requires
meaningful language scopes on all nonwhitespace. `source.*` and `meta.*` alone
do not count; identifier scopes over arbitrary content do not count either.
`index.elyx` must tokenize in under 2,000 ms. UTF-16 code units are used because
TextMate reports offsets in that form; line terminators separate tokenization
calls rather than receiving grammar tokens.

Generated verification evidence lives in `test/output/`:

- `coverage.json` records all nine counts and timings.
- `tokens-first-40.txt` dumps token ranges and scope stacks for the first forty
  lines of each sample fixture, or the entire file if shorter.
- `diagnostics/` retains complete native CLI stdout/stderr and `summary.json`.
- Snapshot logs retain the complete library output.

`diagnostics.cjs` calls
`/Applications/Elyx Preview.app/Contents/Resources/bin/elyx diagnostics` once per
fixture. Override the executable with `ELYX_CLI` if needed. It requires zero
errors for every file. The sample project does not ship the font files that
`text.elyx` loads with `use`, so those missing-font warnings are expected. The
native CLI exits 1 for warnings; this script checks the JSON error counts
explicitly and preserves the warnings for review.
