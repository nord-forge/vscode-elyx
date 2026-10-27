# Visual token hovers in 0.3.0

Hover a token reference or literal token value for a small visual sample.
Colours get a large checkerboard swatch. Radius values get a rounded box.
Spacing gets a measured gap or bars. Typography gets text samples. Other
resolved values get a labelled card. Full value and definition text remain
under the image. These previews never edit a token reference.

The default is enabled:

```json
{"elyx.tokenPreviews.visualHovers": true}
```

Set it to false for text-only hovers. Existing token folders and colour swatch
settings are unchanged. Source locations, property context and naming identify
the sample type. Unsupported units, negative radius values and unknown styles
show labelled values. Large samples fit the card and explain scaling. Local
font fallback applies. Full Elyx layer, theme and variant rendering is not
provided.

## Verification

```text
bun run test: exit 0
204 grammar specification assertions passed.
94 independent grammar review assertions passed.
29 snapshots passed.
All nine sample fixtures have zero unscoped and unclassified characters.
46 colour resolver tests passed.
55 visual preview tests passed.
Combined colour and visual suite: 101 passed, 0 failed.
bun run package: exit 0
elyx-0.3.0.vsix: 10 files, 25.33 KB
```

The independent review found and verified repairs for aggregate hit ranges and
wide text. Hover ranges exclude comments, map keys, argument names and gaps;
opening/closing delimiters and actual values remain hover targets. Wide labels
and value lines now fit and end with ellipses. The reviewer inspected generated
SVG rasters in light and dark palettes.

The real host tests now open a token definition before deleting it. That exposed
an open buffer retaining a deleted token. Disk cache data and buffer overlays
are now separate. Dirty referenced buffers require an existing file; the
current document can still preview its own literals. The delete, create and
unsaved-edit cases pass together.

VS Code isolated Extension Host:

- Activation, automatic .elyx association and three resolved token swatches
- Both default folders and non-colour token values
- Actual registered hover provider reports alpha hex and definition
- Registered hovers include radius, spacing, font size/family, line height and letter spacing graphics
- Colour hover includes a larger checkerboard image
- Token definition literals have visual cards without editing the definition
- Visual hover setting toggles images while keeping resolved values
- Aggregate cards do not appear on map keys or comments
- Unsaved token edit refreshes consumer automatically without changing references
- Live configuration toggle clears and restores decorations
- Changing tokenDirectories drops and restores fallback values
- Token file deletion and creation refresh without reopening the consumer
- Read-only token references have no native colour replacement edits

VSCodium isolated Extension Host:

- Activation, automatic .elyx association and three resolved token swatches
- Both default folders and non-colour token values
- Actual registered hover provider reports alpha hex and definition
- Registered hovers include radius, spacing, font size/family, line height and letter spacing graphics
- Colour hover includes a larger checkerboard image
- Token definition literals have visual cards without editing the definition
- Visual hover setting toggles images while keeping resolved values
- Aggregate cards do not appear on map keys or comments
- Unsaved token edit refreshes consumer automatically without changing references
- Live configuration toggle clears and restores decorations
- Changing tokenDirectories drops and restores fallback values
- Token file deletion and creation refresh without reopening the consumer
- Read-only token references have no native colour replacement edits

The package includes all three CommonJS runtime modules and excludes tests,
fixtures and development dependencies. Packaging reports the expected missing
repository metadata warning because this private beta repo has no remote.
The original design project has not been edited or saved by this work.
Nothing has been published or pushed.

## Installed editor spot check

Version 0.3.0 is installed in VS Code and VSCodium. In VS Code, hovering
`radii.radius.lg` in `design/controls/emailField.elyx` shows a rounded box labelled
`8 px radius`, its resolved value and `design/tokens/radius.elyx` as the source.
In VSCodium, hovering the `124px` padding literal in the copied `openSource.elyx`
fixture shows two blocks, a measured gap labelled `124 px gap`, its value and
source file. Both SVG graphics rendered visibly in native hover popups.

Open the project folder containing the file. Token discovery and visual hovers
run within workspace folders. Opening an unrelated external file while the
extension repository is the workspace does not provide token hovers.
