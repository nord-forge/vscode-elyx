const { describe, test, expect } = require('bun:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createTokenIndex, parseFile } = require('../../src/tokens.js');

const fixture = name => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const original = name => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');
const file = (path, text) => ({ path, text });
const single = text => createTokenIndex([file('design/tokens/colors.elyx', text)]);
const channels = hex => {
  const digits = hex.slice(1);
  const expanded = digits.length < 5 ? [...digits].map(c => c + c).join('') : digits;
  return [0, 2, 4, 6].map((offset, i) => i === 3 && expanded.length === 6
    ? 1 : parseInt(expanded.slice(offset, offset + 2), 16) / 255);
};
function expectColor(actual, hex) {
  expect(actual).toBeDefined();
  expect(actual.color).toBeDefined();
  ['red', 'green', 'blue', 'alpha'].forEach((key, i) => {
    expect(actual.color[key]).toBeCloseTo(channels(hex)[i], 9);
  });
}

describe('trail search component and sample token files', () => {
  const searchPath = 'design/controls/trailSearch.elyx';
  const search = fixture('trailSearch.elyx');
  const colors = original('colors.elyx');
  const index = createTokenIndex([
    file(searchPath, search),
    file('design/tokens/colors.elyx', colors),
    file('design/tokens/spacing.elyx', fixture('spacing.elyx')),
    file('design/tokens/radius.elyx', fixture('radius.elyx')),
  ]);

  test.each([
    ['colors.effects.inkAlpha60', '#1b232899'],
    ['colors.effects.whiteAlpha20', '#ffffff33'],
    ['colors.effects.whiteAlpha80', '#ffffffcc'],
    ['colors.palette.stone', '#d8d2c4'],
  ])('resolves component reference %s with alpha intact', (reference, hex) => {
    expectColor(index.resolve(searchPath, reference), hex);
    const occurrence = index.scan(searchPath).find(item => item.reference === reference);
    expectColor(occurrence, hex);
    expect(search.slice(occurrence.start, occurrence.end)).toBe(reference);
  });

  test.each([
    ['spacing.space.x3', '12'], ['spacing.space.x4', '16'],
    ['spacing.space.x6', '24'], ['radii.radius.md', '6'], ['radii.radius.lg', '8'],
    ['radii.radius.field', '6'], ['radii.radius.sheet', '[16, 16, 0, 0]'],
    ['spacing.inset.field', '[12, 16]'], ['spacing.inset.sheet', '[24, 24, 40]'],
  ])('provides non-color hover value for %s', (reference, value) => {
    expect(index.resolve(searchPath, reference)?.value).toBe(value);
    const occurrence = index.scan(searchPath).find(item => item.reference === reference);
    expect(occurrence?.value).toBe(value);
    expect(occurrence?.color).toBeUndefined();
  });

  test('reports the source definition offsets in the token file', () => {
    const definition = index.resolve(searchPath, 'colors.effects.inkAlpha60').definition;
    expect(definition.path).toBe('design/tokens/colors.elyx');
    expect(definition.start).toBeGreaterThanOrEqual(0);
    expect(definition.end).toBeGreaterThan(definition.start);
    expect(colors.slice(definition.start, definition.end)).toContain('#1b232899');
  });

  test('resolves every authored color token in the sample colors fixture', () => {
    const groups = ['palette', 'trail', 'theme', 'map', 'weather', 'syntax', 'effects'];
    for (const group of groups) {
      const body = colors.match(new RegExp(`export ${group} = tokens \\{([\\s\\S]*?)\\n\\}`))[1];
      for (const [, member] of body.matchAll(/^\s*([\w-]+):/gm)) {
        const result = index.resolve('design/tokens/colors.elyx', `${group}.${member}`);
        expect(result?.color, `${group}.${member}`).toBeDefined();
      }
    }
    expectColor(index.resolve('design/tokens/colors.elyx', 'theme.page'), '#efe9dc');
    expect(index.resolve('design/tokens/colors.elyx', 'theme.footerMuted').color.alpha).toBe(0.6);
    expect(index.resolve('design/tokens/colors.elyx', 'map.forest').color.alpha).toBeCloseTo(0.35, 9);
    expect(index.resolve('design/tokens/colors.elyx', 'map.waterEdge').color.alpha).toBeCloseTo(0.8, 9);
    expectColor(index.resolve('design/tokens/colors.elyx', 'map.route'), '#d9502b');
  });
});

describe('module resolution and immutable snapshots', () => {
  test('local groups, bare member aliases, cross-group aliases, and root references', () => {
    const index = single(`export palette = tokens { base: #123456, same: base }
      export theme = tokens { foreground: palette.same, rooted: ::palette.base }`);
    for (const reference of ['palette.same', 'theme.foreground', 'theme.rooted', '::palette.base']) {
      expectColor(index.resolve('design/tokens/colors.elyx', reference), '#123456');
    }
  });

  test('an explicit import alias wins over fallback, independent of its filename', () => {
    const index = createTokenIndex([
      file('screens/main.elyx', 'import "shared/actual-palette.elyx" as colors\nmain = frame {fill: colors.palette.base}'),
      file('shared/actual-palette.elyx', 'export palette = tokens {base: #123456}'),
      file('design/tokens/colors.elyx', 'export palette = tokens {base: #abcdef}'),
    ]);
    expectColor(index.resolve('screens/main.elyx', 'colors.palette.base'), '#123456');
  });

  test('a missing explicit import must not silently resolve a similarly named fallback', () => {
    const index = createTokenIndex([
      file('screens/main.elyx', 'import "missing.elyx" as colors\nmain = frame {fill: colors.palette.base}'),
      file('design/tokens/colors.elyx', 'export palette = tokens {base: #abcdef}'),
    ]);
    expect(index.resolve('screens/main.elyx', 'colors.palette.base')).toBeUndefined();
  });

  test('workspace-root and importer-relative paths both resolve provided files', () => {
    const index = createTokenIndex([
      file('screens/page.elyx', `import "design/tokens/colors.elyx" as root
        import "../shared/palette.elyx" as nearby
        main = frame {fill: root.palette.base, border: nearby.palette.base}`),
      file('design/tokens/colors.elyx', 'export palette = tokens {base: #123456}'),
      file('shared/palette.elyx', 'export palette = tokens {base: #abcdef}'),
    ]);
    expectColor(index.resolve('screens/page.elyx', 'root.palette.base'), '#123456');
    expectColor(index.resolve('screens/page.elyx', 'nearby.palette.base'), '#abcdef');
  });

  test('bare import paths use the workspace root, and explicit ./ uses the importer folder', () => {
    const index = createTokenIndex([
      file('screens/page.elyx', `import "colors.elyx" as root
        import "./colors.elyx" as nearby
        main = frame {fill: root.palette.base, border: nearby.palette.base}`),
      file('colors.elyx', 'export palette = tokens {base: #123456}'),
      file('screens/colors.elyx', 'export palette = tokens {base: #abcdef}'),
    ]);
    expectColor(index.resolve('screens/page.elyx', 'root.palette.base'), '#123456');
    expectColor(index.resolve('screens/page.elyx', 'nearby.palette.base'), '#abcdef');
  });

  test('private groups are visible locally and unavailable through imports or fallback', () => {
    const path = 'design/tokens/colors.elyx';
    const index = createTokenIndex([
      file(path, 'privatePalette = tokens {base: #123456}\nexport palette = tokens {base: privatePalette.base}'),
      file('page.elyx', 'import "design/tokens/colors.elyx" as imported\nmain = frame {}'),
    ]);
    expectColor(index.resolve(path, 'privatePalette.base'), '#123456');
    expectColor(index.resolve('page.elyx', 'imported.palette.base'), '#123456');
    expect(index.resolve('page.elyx', 'imported.privatePalette.base')).toBeUndefined();
    expect(index.resolve('page.elyx', 'colors.privatePalette.base')).toBeUndefined();
  });

  test.each(['design/tokens', 'elyx/tokens'])('default fallback searches %s', directory => {
    const index = createTokenIndex([
      file('page.elyx', 'main = frame {fill: colors.palette.base}'),
      file(`${directory}/colors.elyx`, 'export palette = tokens {base: #123456}'),
    ]);
    expectColor(index.resolve('page.elyx', 'colors.palette.base'), '#123456');
  });

  test('custom folders replace defaults and do not admit adjacent folders', () => {
    const index = createTokenIndex([
      file('page.elyx', 'main = frame {}'),
      file('theme/tokens/brand.elyx', 'export palette = tokens {base: #123456}'),
      file('theme/tokens-other/outside.elyx', 'export palette = tokens {base: #abcdef}'),
      file('design/tokens/colors.elyx', 'export palette = tokens {base: #fedcba}'),
    ], ['theme/tokens']);
    expectColor(index.resolve('page.elyx', 'brand.palette.base'), '#123456');
    expect(index.resolve('page.elyx', 'outside.palette.base')).toBeUndefined();
    expect(index.resolve('page.elyx', 'colors.palette.base')).toBeUndefined();
  });

  test('ambiguous fallback filenames fail instead of choosing an arbitrary folder', () => {
    const index = createTokenIndex([
      file('page.elyx', 'main = frame {}'),
      file('design/tokens/colors.elyx', 'export palette = tokens {base: #123456}'),
      file('elyx/tokens/colors.elyx', 'export palette = tokens {base: #abcdef}'),
    ]);
    expect(index.resolve('page.elyx', 'colors.palette.base')).toBeUndefined();
  });

  test('rebuilding from dirty text changes the new snapshot without mutating the old one', () => {
    const files = [file('page.elyx', 'main = frame {fill: colors.palette.base}'),
      file('design/tokens/colors.elyx', 'export palette = tokens {base: #123456}')];
    const before = createTokenIndex(files);
    files[1].text = 'export palette = tokens {base: #abcdef}';
    const after = createTokenIndex(files);
    expectColor(before.resolve('page.elyx', 'colors.palette.base'), '#123456');
    expectColor(after.resolve('page.elyx', 'colors.palette.base'), '#abcdef');
    const parsed = parseFile(files[1].text);
    expect(Object.isFrozen(parsed)).toBe(true);
  });
});

describe('values and safe failure', () => {
  test('nested maps, lists, hyphen names, lengths, and quoted hover values', () => {
    const path = 'design/tokens/colors.elyx';
    const index = single(`export brand-colors = tokens {
      sea-blue: #2f6f8f,
      gap: 12px,
      title: "Hello world",
      nested: {paint: sea-blue, padding: [gap, 4px]},
      sizes: [gap, 8px]
    }`);
    expectColor(index.resolve(path, 'brand-colors.sea-blue'), '#2f6f8f');
    expect(index.resolve(path, 'brand-colors.gap').value).toBe('12px');
    expect(index.resolve(path, 'brand-colors.title').value).toContain('Hello world');
    const nested = index.resolve(path, 'brand-colors.nested');
    expect(nested?.value).toContain('paint');
    expect(nested?.value).toContain('12px');
    expect(index.resolve(path, 'brand-colors.sizes')?.value).toContain('8px');
  });

  test('missing members, alias cycles, and inheritance cycles terminate without a result', () => {
    const path = 'design/tokens/colors.elyx';
    const index = single(`export palette = tokens {a: b, b: a, missing: absent}
      export first = tokens : second {}
      export second = tokens : first {}`);
    for (const reference of ['palette.a', 'palette.b', 'palette.missing', 'palette.nope', 'first.color']) {
      expect(index.resolve(path, reference)).toBeUndefined();
    }
    expect(index.scan(path)).toEqual([]);
  });

  test.each(['#abc', '#abcd', '#A1B2C3', '#A1B2C340'])('supports exactly valid hex length: %s', hex => {
    const index = single(`export palette = tokens {base: ${hex}}`);
    expectColor(index.resolve('design/tokens/colors.elyx', 'palette.base'), hex);
    const scan = index.scan('design/tokens/colors.elyx');
    expect(scan).toHaveLength(1);
    expectColor(scan[0], hex);
  });

  test.each(['#12345', '#1234567', '#123456789', '#12gg34'])('rejects an entire invalid hex literal: %s', hex => {
    const index = single(`export palette = tokens {base: ${hex}}`);
    expect(index.resolve('design/tokens/colors.elyx', 'palette.base')).toBeUndefined();
    expect(index.scan('design/tokens/colors.elyx')).toEqual([]);
  });

  test('opacity replaces alpha and scans one full call without overlapping swatches', () => {
    const text = `export palette = tokens {base: #12345680, muted: opacity(base, 25%), fractional: opacity(base, 0.5)}`;
    const path = 'design/tokens/colors.elyx';
    const index = single(text);
    expect(index.resolve(path, 'palette.muted').color.alpha).toBe(0.25);
    expect(index.resolve(path, 'palette.fractional').color.alpha).toBe(0.5);
    const scan = index.scan(path);
    const calls = scan.filter(item => text.slice(item.start, item.end).startsWith('opacity('));
    expect(calls).toHaveLength(2);
    expect(text.slice(calls[0].start, calls[0].end)).toBe('opacity(base, 25%)');
    for (let i = 0; i < scan.length; i++) {
      for (let j = i + 1; j < scan.length; j++) {
        expect(scan[i].end <= scan[j].start || scan[j].end <= scan[i].start).toBe(true);
      }
    }
  });

  test('unsupported functions do not produce an invented color', () => {
    const index = single('export palette = tokens {base: mystery(#fff, 0.5)}');
    expect(index.resolve('design/tokens/colors.elyx', 'palette.base')).toBeUndefined();
  });
});

describe('lexical scanning and source semantics', () => {
  test('ignores comments, strings, keys, source declarations, and annotation arguments', () => {
    const path = 'page.elyx';
    const text = `import "design/tokens/colors.elyx" as colors
      // colors.palette.base #fff .white opacity(#fff, 50%)
      @with-variant(colors.palette.base)
      main = frame : colors.palette.base {
        colors.palette.base: "colors.palette.base #fff .white",
        fill[0].color: colors.palette.base,
        caption: "Escaped \\" #abcdef colors.palette.base",
        nested: {colors.palette.base: colors.palette.base}
      }`;
    const index = createTokenIndex([file(path, text),
      file('design/tokens/colors.elyx', 'export palette = tokens {base: #2f6f8f}')]);
    const occurrences = index.scan(path);
    expect(occurrences).toHaveLength(2);
    const expectedOffsets = [text.indexOf('colors.palette.base,\n        caption'),
      text.lastIndexOf('colors.palette.base}')];
    expect(occurrences.map(item => item.start)).toEqual(expectedOffsets);
    occurrences.forEach(item => expectColor(item, '#2f6f8f'));
  });

  test('UTF-16 offsets remain aligned after astral Unicode text', () => {
    const path = 'page.elyx';
    const text = 'main = frame {title: "😀 › ✓", fill: colors.palette.base, border: #aBcD}';
    const index = createTokenIndex([file(path, text),
      file('design/tokens/colors.elyx', 'export palette = tokens {base: #2f6f8f}')]);
    const occurrences = index.scan(path);
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0].start).toBe(text.indexOf('colors.palette.base'));
    expect(text.slice(occurrences[0].start, occurrences[0].end)).toBe('colors.palette.base');
    expect(text.slice(occurrences[1].start, occurrences[1].end)).toBe('#aBcD');
  });

  test('inherited aliases keep the source group lexical binding', () => {
    const index = createTokenIndex([
      file('design/tokens/base.elyx', `export palette = tokens {base: #123456}
        export theme = tokens {base: #123456, alias: base, cross: palette.base}`),
      file('design/tokens/derived.elyx', `import "design/tokens/base.elyx" as origin
        export palette = tokens {base: #ff0000}
        export theme = tokens : origin.theme {base: #abcdef, local: base}`),
      file('page.elyx', 'main = frame {fill: derived.theme.alias}'),
    ]);
    expectColor(index.resolve('page.elyx', 'derived.theme.base'), '#abcdef');
    expectColor(index.resolve('page.elyx', 'derived.theme.local'), '#abcdef');
    expectColor(index.resolve('page.elyx', 'derived.theme.alias'), '#123456');
    expectColor(index.resolve('page.elyx', 'derived.theme.cross'), '#123456');
  });

  test('the sample dark-theme file inherits explicit authored values without executing context', () => {
    const index = createTokenIndex([
      file('design/tokens/colors.elyx', original('colors.elyx')),
      file('design/tokens/colors.dark.elyx', original('colors.dark.elyx')),
    ]);
    expectColor(index.resolve('design/tokens/colors.dark.elyx', 'darkTheme.page'), '#0e1612');
    expectColor(index.resolve('design/tokens/colors.dark.elyx', 'darkTheme.mapOverlay'), '#ffffff');
    expectColor(index.resolve('design/tokens/colors.elyx', 'theme.page'), '#efe9dc');
  });
});
