# Token previews in 0.2.0

Colour references now get read-only inline swatches. Hover shows resolved values
and their source files. Non-colour token references show values on hover.
The default folders are `design/tokens` and `elyx/tokens`, relative to the open
workspace. Explicit `.elyx` imports are followed. Missing, cyclic, ambiguous or
unsupported references stay unresolved.

```json
{
  "elyx.tokenDirectories": ["design/tokens", "elyx/tokens"],
  "elyx.colorPreviews.enabled": true
}
```

The original screenshot references resolve as follows:

| Reference | Value |
| --- | --- |
| colors.effects.whiteAlpha7 | #ffffff12 |
| colors.effects.whiteAlpha10 | #ffffff1a |
| colors.palette.grayDark | #a5a4a3 |
| spacing.space.x3 | 12 |
| radii.radius.lg | 8 |

Transparent colours use checkerboard swatches. The extension never replaces a
token expression with a literal colour. It does not run the Elyx CLI.

## Checks

`bun run test` passed:

```text
204 semantic assertions passed across 19 specification cases.
94 independent review assertions passed.
29 snapshots passed (9 sample fixtures, 20 specification cases).
All nine fixtures: source-only=0; unclassified=0.
index.elyx tokenization: 59.74 ms (limit 2000 ms).
46 token resolver tests passed, 0 failed, 453 assertions.
```

A fresh reviewer added nine focused tests and recorded a bounded PASS. A Node-only read-only corpus scan indexed all 98 design
files in about 127 ms. It found 2,286 resolved occurrences, including 1,292
colours. All offsets matched the exact source slices and colour channels were
finite and within range. No original design file was edited.

The installed VS Code app and VSCodium app each passed eight real Extension Host
checks in isolated temporary profiles and workspaces:

VS Code:

- Activation, automatic .elyx association and three resolved token swatches
- Both default folders and non-colour token values
- Actual registered hover provider reports alpha hex and definition
- Unsaved token edit refreshes consumer automatically without changing references
- Live configuration toggle clears and restores decorations
- Changing tokenDirectories drops and restores fallback values
- Token file deletion and creation refresh without reopening the consumer
- Read-only token references have no native colour replacement edits

VSCodium:

- Activation, automatic .elyx association and three resolved token swatches
- Both default folders and non-colour token values
- Actual registered hover provider reports alpha hex and definition
- Unsaved token edit refreshes consumer automatically without changing references
- Live configuration toggle clears and restores decorations
- Changing tokenDirectories drops and restores fallback values
- Token file deletion and creation refresh without reopening the consumer
- Read-only token references have no native colour replacement edits

VSCodium initially exposed stale deleted-file cache data. File system and
workspace create/delete/rename events now invalidate the token snapshot and
request discovery again. Both final host runs passed after that repair.

`bun run package` passed and produced `elyx-0.2.0.vsix` with nine files, about
18.51 KB. The package includes both runtime modules and no tests, design
fixtures, build scripts or development dependencies. Its only warning is the
expected missing repository metadata for this local-only beta repo.

The two initial hover test failures came from serializing VS Code MarkdownString
objects instead of reading their value property. The provider returned hover
content. The corrected host check reads and asserts the actual hover text.

## Bounds

Static token aliases, nested values and inheritance are supported. Inherited
aliases retain the authoring scope. Hex colours, common colour atoms, opacity,
rgb, rgba and hsl are supported. Theme and variant context execution, arbitrary
functions, OKLCH, arithmetic, quoted evaluation, dependency imports and general
layer lexical scopes are not implemented. Unsupported values are left alone.

The new runtime feature is for VS Code and VSCodium. Zed keeps its existing
syntax-only support. The grammar itself did not change in this release.

## Installed editor check

Version 0.2.0 installed successfully in both local editor profiles. The coordinator
applied each editor's Restart Extensions action and inspected the real newsletter
component. VS Code shows checkerboard swatches beside whiteAlpha7 and whiteAlpha10.
VSCodium shows the whiteAlpha80 swatch and the solid royalBlueLight swatch.
The existing unsaved index buffer in VSCodium stayed open and was not saved or
changed by this work. No original design file was edited. Nothing was published.
