# Token preview tests

Run `bun test test/colors` from the extension root.

These tests exercise the pure CommonJS API in `src/tokens.js` using the public
contract in `docs/color-contract.md`. Expected values come from authored token
fixtures and small isolated examples. The tests do not load VS Code, read a live
workspace, execute Elyx, or test adapter caching and filesystem events.

`fixtures/trailSearch.elyx`, `fixtures/spacing.elyx`, and `fixtures/radius.elyx`
belong to the Brambleway sample design project written for these tests. The
search field references translucent colours, spacing steps, a nested inset
list and a four-corner radius. The grammar fixtures `test/fixtures/colors.elyx`
and `colors.dark.elyx` supply the full sample palette and its inherited dark
theme.

The cases cover the component references, non-color hover values, source
offsets, import aliases and visibility, configured fallback folders, ambiguity,
immutable dirty-text snapshots, missing members and cycles, nested values,
valid and invalid hex literals, opacity, scanner exclusions, UTF-16 offsets,
and static lexical inheritance. Variant and theme context evaluation remains
outside the core contract.
