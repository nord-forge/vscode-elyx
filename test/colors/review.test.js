const { describe, test, expect } = require('bun:test');
const { createTokenIndex } = require('../../src/tokens.js');

const file = (path, text) => ({path, text});
const palette = file('design/tokens/colors.elyx', 'export palette = tokens {base: #123456}');

describe('independent token preview review regressions', () => {
  test('a layer declaration shadows a matching fallback file stem', () => {
    const text = 'colors = frame {}\nmain = frame {fill: colors.palette.base}';
    const index = createTokenIndex([palette, file('page.elyx', text)]);
    expect(index.resolve('page.elyx', 'colors.palette.base')).toBeUndefined();
    expect(index.scan('page.elyx')).toEqual([]);
  });

  test('a layer and import alias collision fails without choosing the token file', () => {
    const text = 'import "design/tokens/colors.elyx" as colors\ncolors = frame {}\nmain = frame {fill: colors.palette.base}';
    const index = createTokenIndex([palette, file('page.elyx', text)]);
    expect(index.resolve('page.elyx', 'colors.palette.base')).toBeUndefined();
    expect(index.scan('page.elyx')).toEqual([]);
  });

  test('prototype property names are ordinary non-color atoms', () => {
    const index = createTokenIndex([file('page.elyx', 'export values = tokens {first: .constructor, second: .toString, third: .__proto__}')]);
    for (const name of ['first', 'second', 'third']) {
      expect(index.resolve('page.elyx', `values.${name}`)?.color).toBeUndefined();
    }
    expect(index.scan('page.elyx')).toEqual([]);
  });

  test('overflowing numeric hue cannot produce non-finite color channels', () => {
    const index = createTokenIndex([file('page.elyx', `export values = tokens {base: hsl(${'9'.repeat(400)}, 100%, 50%)}`)]);
    expect(index.resolve('page.elyx', 'values.base')).toBeUndefined();
    expect(index.scan('page.elyx')).toEqual([]);
  });

  test('quoted expressions, map keys and named argument names never become previews', () => {
    const text = `main = frame {quoted: 'colors.palette.base, map: {"#fff colors.palette.base": colors.palette.base, .white: .white}, call: custom(colors = colors.palette.base)}`;
    const index = createTokenIndex([palette, file('page.elyx', text)]);
    expect(index.scan('page.elyx').map(item => text.slice(item.start, item.end))).toEqual(['colors.palette.base', '.white', 'colors.palette.base']);
  });

  test('duplicate token members and duplicate import aliases fail safely', () => {
    const index = createTokenIndex([
      palette,
      file('page.elyx', 'import "design/tokens/colors.elyx" as colors\nimport "design/tokens/colors.elyx" as colors\nexport local = tokens {base: #fff, base: #000}'),
    ]);
    expect(index.resolve('page.elyx', 'colors.palette.base')).toBeUndefined();
    expect(index.resolve('page.elyx', 'local.base')).toBeUndefined();
  });

  test('map and list aliases resolve selected members without executing expressions', () => {
    const index = createTokenIndex([file('page.elyx', 'export colors = tokens {base: #123456, paints: [{color: base}], alias: paints, unknown: mystery(base)}')]);
    expect(index.resolve('page.elyx', 'colors.alias[0].color')?.color).toEqual({red: 0x12 / 255, green: 0x34 / 255, blue: 0x56 / 255, alpha: 1});
    expect(index.resolve('page.elyx', 'colors.unknown')).toBeUndefined();
  });

  test('resolved color calls suppress nested occurrences and preserve alpha', () => {
    const text = 'main = frame {fill: opacity(opacity(colors.palette.base, 25%), 50%)}';
    const index = createTokenIndex([palette, file('page.elyx', text)]);
    const scan = index.scan('page.elyx');
    expect(scan).toHaveLength(1);
    expect(scan[0].reference).toBe('opacity(opacity(colors.palette.base, 25%), 50%)');
    expect(scan[0].color.alpha).toBe(0.5);
  });

  test('workspace escape and absolute imports cannot fall back to a matching alias', () => {
    for (const path of ['../outside.elyx', '/outside.elyx', 'C:/outside.elyx']) {
      const index = createTokenIndex([palette, file('page.elyx', `import "${path}" as colors\nmain = frame {fill: colors.palette.base}`)]);
      expect(index.resolve('page.elyx', 'colors.palette.base')).toBeUndefined();
      expect(index.scan('page.elyx')).toEqual([]);
    }
  });
});
