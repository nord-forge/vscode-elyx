# Elyx language notes

These notes describe the parts of the Elyx language that the grammar, the
token resolver and the Zed parser rely on. The authoritative grammar is
`elyx man abnf` from the Elyx CLI. `elyx man syntax` covers the rules the ABNF
leaves to prose.

### Lexical

- **Comments**: only `//` line comments. No block comments.
- **Strings**: double quotes only. Escapes `\n \r \t \" \\`. Strings may
  contain any Unicode (`"›"`, `"✓"`), but not raw newlines.
- **Single quote** is not a string: `'expr` is a quote operator.
- **Symbols**: `[A-Za-z_-][A-Za-z0-9_-]*`. Hyphens are legal inside names
  (`brand-blue`, `x2-5`, `space-between`). A digit start is a number.
- **Qualified symbols**: `a.b.c` with no spaces around dots. A leading `::`
  starts at the file root (`::colors.palette`).
- **Paths in property keys**: `fill[0].color`, `shadow[1].inner-shadow.blur-radius`.
- **Numbers**: `16`, `0.5`, `-12`, `+3`.
- **Lengths**: number plus unit, no space: `16px`, `50%`, `180deg`, `12pt`.
  The grammar accepts any symbol as unit; in practice `px`, `%`, `deg`, `pt`.
- **Hex colours**: `#` plus exactly 3, 4, 6 or 8 hex digits (`#2b6cb0`,
  `#ffffff08`).
- **Atoms**: `.` plus a symbol: `.true`, `.false`, `.nil`, `.center`,
  `.column`, `.space-between`, `.gaussian-blur`, `.transparent`, `.white`.
- **Operators**: `+ - * /` with whitespace before the operator; `:` `=` `,`
  `.` `::` and brackets `() [] {}`.

### Keywords

- **Declarations and modules**: `import`, `as`, `use`, `export`, `priv`.
- **Kinds** (type keywords): `frame`, `boolean`, `tokens`, `text`, `shape`,
  `asset`, `icon` (legacy).
- **Contextual**: `file` is a metadata block only when followed by `{`
  (`file {}`); elsewhere it is an ordinary name.
- **Reserved for future use** (never valid as names): `board`, `component`,
  `group`, `__board__`, `__document__`, `let`, `const`, `fn`, `this`, `self`,
  `children`, `where`, `type`, `trait`, `super`, `struct`, `static`, `ref`,
  `mod`, `loop`, `in`, `data`, `async`, `await`, `if`, `when`, `then`,
  `else`, `match`, `case`, `not`, `and`, `or`, `try`, `catch`, `rescue`,
  `finally`, `throw`, `return`. The app's tokenizer also knows
  `__file__` and `__canvas__`.

### Annotations

`@name` or `@name(args)` on the line before a declaration or sub-block.
Arguments are `key = value`, values are strings or symbol paths.

- `@variant`
- `@context(theme="dark")` and `@context(theme=dark)`
- `@with-context(theme="dark")`, `@with-context`, `@with-context()`
- `@with-variant(nav.sidebarItemActive)`
- `@use-variant(...)` (deprecated spelling of `@with-variant`)

### Structures

```elyx
use "public/fonts/Display-Bold.woff2"                  // font, no alias
import "design/tokens/colors.elyx" as colors             // alias required

@context(theme="dark")
file { draw-connections: .true }                         // file metadata block

export palette = tokens { brandBlue: #2b6cb0 }            // token group
export darkTheme = tokens : colors.theme { page: #050508 } // token instance

export button = frame {                                  // definition
  title: "Work with us button",                          // property: key, value
  left: 0px,
  top: 0px,
  layout: {direction: .row, item-gap: 8px},              // map value
  padding: [8px, 16px],                                  // list value
  fill: {linear-gradient: {angle: 180deg, stops: [stop(0%, #fff), stop(100%, .transparent)]}},
  children: label,

  label = text : typography.base {                       // nested declaration, instance
    contents: "Work with us",
    fill[0].color: colors.palette.royalBlue              // indexed property path
  }
}

@variant
export buttonHover = frame : button {                    // variant
  left: 200px,
  fill[0].color: #82d8af,
  label { contents: "Hover" }                            // override sub-block (no = and no :)
  overrides: [insert(badge, after = .nil)]               // structural edit
  badge = frame {width: 8px, height: 8px}
}
```

Three line shapes a grammar must tell apart:

| Shape | Example | Meaning |
| --- | --- | --- |
| `name = kind {` / `name = kind : Source {` | `label = text : typography.base {` | declaration |
| `key: value` | `fill[0].color: #fff` | property |
| `name {` (no `=`, no `:`) | `label { contents: "Hi" }` | override sub-block |

