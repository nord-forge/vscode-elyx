const { describe, test, expect } = require('bun:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createTokenIndex } = require('../../src/tokens.js');
const { enrichPreviewItems, createVisualPreview } = require('../../src/previews.js');

const fixture = name => readFileSync(join(__dirname, '..', 'colors', 'fixtures', name), 'utf8');
const original = name => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');
const item = (reference, value, extra = {}) => ({ start: 0, end: value.length, reference, value, ...extra });
const themes = [true, false];
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
const tags = (svg, name) => [...svg.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(m => attrs(m[0]));
const visible = preview => preview.alt + ' ' + preview.svg.replace(/<[^>]+>/g, ' ');

function validPreview(preview) {
  expect(preview).toBeDefined();
  expect(preview.width).toBe(320);
  expect(Number.isFinite(preview.height)).toBe(true);
  expect(preview.height).toBeGreaterThan(40);
  expect(preview.height).toBeLessThanOrEqual(600);
  expect(preview.alt.trim().length).toBeGreaterThan(0);
  expect(preview.svg).toMatch(/^<svg\b/);
  expect(preview.svg).not.toMatch(/<(?:script|html|iframe|image|foreignObject)\b/i);
  for (const [, tag] of preview.svg.matchAll(/<([a-z][^>]*)>/gi)) {
    for (const name of Object.keys(attrs(tag))) expect(name).not.toMatch(/^on|^(?:href|src|xlink:href)$/i);
  }
  expect(preview.svg).not.toMatch(/\b(?:NaN|Infinity|undefined)\b/);
  for (const [, value] of preview.svg.matchAll(/\b(?:x|y|x1|x2|y1|y2|width|height|rx|ry|r|cx|cy|font-size|stroke-width|opacity|fill-opacity)="([^"]+)"/g)) {
    expect(value).toMatch(/^-?(?:\d*\.)?\d+(?:px|%)?$/);
    expect(Number.isFinite(parseFloat(value))).toBe(true);
    expect(Math.abs(parseFloat(value))).toBeLessThanOrEqual(10000);
  }
  for (const path of tags(preview.svg, 'path')) {
    for (const value of (path.d || '').match(/-?(?:\d*\.)?\d+/g) || []) {
      expect(Number.isFinite(Number(value))).toBe(true);
      expect(Math.abs(Number(value))).toBeLessThanOrEqual(Math.max(preview.width, preview.height));
    }
  }
  return preview;
}

function preview(reference, value, isDark = true, extra = {}) {
  return validPreview(createVisualPreview(item(reference, value, extra), { isDark }));
}

// Read corner geometry from ordinary SVG path commands, independent of the
// preview's origin, box size, labels, palette, and exact path serialization.
function corners(svg) {
  return tags(svg, 'path').flatMap(path => {
    let point = [0, 0];
    let tangent;
    const found = [];
    for (const [, command, coordinates] of (path.d || '').matchAll(/([MHVQAZ])([^A-Za-z]*)/g)) {
      const n = (coordinates.match(/-?(?:\d*\.)?\d+/g) || []).map(Number);
      if (command === 'M') point = n;
      if (command === 'H') { point = [n[0], point[1]]; tangent = 'horizontal'; }
      if (command === 'V') { point = [point[0], n[0]]; tangent = 'vertical'; }
      if (command === 'Q') {
        const [x, y, endX, endY] = n;
        const before = Math.hypot(point[0] - x, point[1] - y);
        const after = Math.hypot(endX - x, endY - y);
        expect(before).toBeCloseTo(after, 8);
        found.push({ x, y, radius: before });
        point = [endX, endY];
      }
      if (command === 'A') {
        const [radiusX, radiusY, , , , endX, endY] = n;
        expect(radiusX).toBe(radiusY);
        found.push({ x: tangent === 'horizontal' ? endX : point[0], y: tangent === 'horizontal' ? point[1] : endY, radius: radiusX });
        point = [endX, endY];
      }
    }
    return found;
  });
}

describe('trail search references and authored token literals', () => {
  const documentPath = 'design/controls/trailSearch.elyx';
  const text = fixture('trailSearch.elyx');
  const radius = fixture('radius.elyx');
  const spacing = fixture('spacing.elyx');
  const index = createTokenIndex([
    { path: documentPath, text },
    { path: 'design/tokens/radius.elyx', text: radius },
    { path: 'design/tokens/spacing.elyx', text: spacing },
    { path: 'design/tokens/colors.elyx', text: original('colors.elyx') },
  ]);

  test.each(themes)('imported radius.lg becomes a labelled 8px rounded sample, dark=%s', isDark => {
    const enriched = enrichPreviewItems(text, documentPath, index.scan(documentPath));
    const occurrence = enriched.find(p => p.reference === 'radii.radius.lg');
    expect(text.slice(occurrence.start, occurrence.end)).toBe('radii.radius.lg');
    const card = validPreview(createVisualPreview(occurrence, { isDark }));
    expect(card.kind).toBe('radius');
    expect(visible(card)).toMatch(/8\s*px/i);
    const roundedRect = tags(card.svg, 'rect').some(r => Number(r.rx) === 8);
    expect(roundedRect || corners(card.svg).some(c => c.radius === 8)).toBe(true);
  });

  test('literal token value receives its group label and exact UTF-16 span', () => {
    const path = 'design/tokens/radius.elyx';
    const enriched = enrichPreviewItems(radius, path, index.scan(path));
    const literal = enriched.find(p => p.reference === 'radius.lg');
    expect(literal).toBeDefined();
    expect(literal.start).toBe(radius.indexOf('lg: 8') + 4);
    expect(radius.slice(literal.start, literal.end)).toBe('8');
    expect(literal.value).toBe('8');
    expect(createVisualPreview(literal).kind).toBe('radius');
  });

  test.each(themes)('spacing aliases and aggregate padding form useful thumbnails, dark=%s', isDark => {
    const enriched = enrichPreviewItems(text, documentPath, index.scan(documentPath));
    for (const [reference, value] of [['spacing.space.x3', '12'], ['spacing.space.x4', '16'], ['spacing.space.x6', '24']]) {
      const occurrence = enriched.find(p => p.reference === reference);
      const card = validPreview(createVisualPreview(occurrence, { isDark }));
      expect(card.kind).toBe('spacing');
      expect(visible(card)).toContain(value);
      expect(tags(card.svg, 'rect').length + tags(card.svg, 'line').length).toBeGreaterThan(1);
    }
    const padding = enriched.find(p => text.slice(p.start, p.end) === '[spacing.space.x4, spacing.space.x6]');
    expect(padding?.value).toBe('[16, 24]');
    expect(createVisualPreview(padding, { isDark }).kind).toBe('spacing');
  });

  test.each(themes)('a four-corner radius token draws each corner, dark=%s', isDark => {
    const enriched = enrichPreviewItems(text, documentPath, index.scan(documentPath));
    const occurrence = enriched.find(p => p.reference === 'radii.radius.sheet');
    expect(occurrence?.value).toBe('[16, 16, 0, 0]');
    const card = validPreview(createVisualPreview(occurrence, { isDark }));
    expect(card.kind).toBe('radius');
    expect(visible(card)).toMatch(/16.*16.*0.*0/s);
  });

  test.each(themes)('sample typography literal is classified by its property, dark=%s', isDark => {
    const path = 'design/typography/text.elyx';
    const text = original('text.elyx');
    const index = createTokenIndex([{ path, text }]);
    const enriched = enrichPreviewItems(text, path, index.scan(path));
    const leading = enriched.find(p => p.start === text.indexOf('line-height: 1.33') + 'line-height: '.length);
    expect(leading?.value).toBe('1.33');
    const card = validPreview(createVisualPreview(leading, { isDark }));
    expect(card.kind).toBe('line-height');
    expect(visible(card)).toMatch(/1\.33/);
    expect(tags(card.svg, 'text').length).toBeGreaterThan(2);
  });
});

describe.each(themes)('visual meaning and bounded geometry, dark=%s', isDark => {
  test('four corners follow top-left, top-right, bottom-right, bottom-left order', () => {
    const card = preview('frame.corner-radius', '[2, 6, 12, 20]', isDark);
    expect(card.kind).toBe('radius');
    const shape = corners(card.svg);
    expect(shape).toHaveLength(4);
    const top = shape.filter(c => c.y === Math.min(...shape.map(c => c.y))).sort((a, b) => a.x - b.x);
    const bottom = shape.filter(c => c.y === Math.max(...shape.map(c => c.y))).sort((a, b) => b.x - a.x);
    expect([...top, ...bottom].map(c => c.radius)).toEqual([2, 6, 12, 20]);
    expect(visible(card)).toMatch(/2.*6.*12.*20/s);
  });

  test('zero corners stay square, while 9999 represents a pill', () => {
    const square = preview('radius.none', '0', isDark);
    const pill = preview('radius.full', '9999', isDark);
    expect(square.kind).toBe('radius');
    expect(pill.kind).toBe('radius');
    expect(visible(square)).toMatch(/0\s*px/);
    expect(visible(pill)).toMatch(/9999|pill/i);
    expect(corners(square.svg).every(c => c.radius === 0)).toBe(true);
    const rounded = tags(pill.svg, 'rect').some(r => Number(r.rx) > 0 && Number(r.rx) === Number(r.height) / 2);
    const shape = corners(pill.svg);
    const halfHeight = (Math.max(...shape.map(c => c.y)) - Math.min(...shape.map(c => c.y))) / 2;
    expect(rounded || shape.length === 4 && shape.every(c => c.radius === halfHeight && c.radius > 0)).toBe(true);
  });

  test.each(['-4', '2em', '25%', 'banana', '[2, 4, 6]', '[2, -4, 6, 8]'])('unsupported radius %s gets an honest value card', value => {
    const card = preview('radius.custom', value, isDark);
    expect(card.kind).toBe('value');
    expect(visible(card)).toContain(value);
  });

  test('spacing names its unit and retains negative/oversized authored values', () => {
    const normal = preview('spacing.space.x4', '16px', isDark);
    const negative = preview('margin.left', '-12', isDark);
    const huge = preview('spacing.space.huge', '1000000', isDark);
    expect(normal.kind).toBe('spacing');
    expect(visible(normal)).toMatch(/16\s*px/i);
    expect(visible(negative)).toMatch(/-12/);
    expect(visible(negative)).toMatch(/negative|signed|offset|value/i);
    expect(visible(huge)).toContain('1000000');
    expect(visible(huge)).toMatch(/scale|scaled|clamp|fit/i);
    expect(preview('spacing.relative', '2em', isDark).kind).toBe('value');
  });

  test('font-size shows a text specimen, with scale explained for oversized fonts', () => {
    const card = preview('fontSize.lg', '18', isDark);
    expect(card.kind).toBe('font-size');
    expect(visible(card)).toMatch(/18\s*px/i);
    expect(tags(card.svg, 'text').some(t => Number(t['font-size']) === 18)).toBe(true);
    const huge = preview('font-size', '1000000px', isDark);
    expect(visible(huge)).toMatch(/1000000/);
    expect(visible(huge)).toMatch(/scale|scaled|clamp|fit/i);
    expect(preview('fontSize.relative', '2em', isDark).kind).toBe('value');
  });

  test('automatic line height and unitless multipliers follow the text schema', () => {
    const automatic = preview('text.line-height', '0', isDark);
    expect(automatic.kind).toBe('line-height');
    expect(visible(automatic)).toMatch(/auto/i);
    const multiplier = preview('lineHeight.relaxed', '1.5', isDark);
    expect(multiplier.kind).toBe('line-height');
    expect(visible(multiplier)).toMatch(/1\.5/);
    expect(visible(multiplier)).toMatch(/multiplier|×|times|font size/i);
    expect(preview('lineHeight.invalid', '-1', isDark).kind).toBe('value');
    expect(preview('lineHeight.unsupported', '24px', isDark).kind).toBe('value');
  });

  test('letter spacing is a percentage of the font size', () => {
    for (const value of ['5', '5%', '-2']) {
      const card = preview('letterSpacing.wide', value, isDark);
      expect(card.kind).toBe('letter-spacing');
      expect(visible(card)).toMatch(/%/);
      expect(visible(card)).toMatch(/font size|percent/i);
    }
    expect(preview('letter-spacing', '2em', isDark).kind).toBe('value');
  });

  test('font family and weight use meaningful specimens', () => {
    const family = preview('fonts.body', '"Inter Display"', isDark);
    expect(family.kind).toBe('font-family');
    expect(visible(family)).toContain('Inter Display');
    expect(visible(family)).toMatch(/local|fallback|installed/i);
    expect(tags(family.svg, 'text').length).toBeGreaterThan(1);
    const weight = preview('fontWeight.bold', '700', isDark);
    expect(weight.kind).toBe('font-weight');
    expect(tags(weight.svg, 'text').some(t => t['font-weight'] === '700')).toBe(true);
  });

  test('numeric colour data has precedence and alpha is shown on a checkerboard', () => {
    const opaque = preview('radius.red', '#ff0000', isDark, { color: { red: 1, green: 0, blue: 0, alpha: 1 } });
    const alpha = preview('radius.red', '#ff000080', isDark, { color: { red: 1, green: 0, blue: 0, alpha: 0.5 } });
    expect(opaque.kind).toBe('colour');
    expect(alpha.kind).toBe('colour');
    expect(alpha.svg).toMatch(/<pattern\b|checker/i);
    expect(alpha.svg).toMatch(/(?:fill-opacity|opacity)="0\.5"|rgba\([^)]*0\.5\)/);
    expect(alpha.svg).not.toBe(opaque.svg);
  });

  test.each(['"hello"', '.center', '[1, 2, 3]', '{foo: 8, bar: "hi"}'])('generic resolved value %s stays readable', value => {
    const card = preview('misc.custom', value, isDark);
    expect(card.kind).toBe('value');
    expect(visible(card)).toContain(value.replace(/"/g, '&quot;'));
  });
});

describe('SVG safety and themes', () => {
  test('property context and token definition paths classify otherwise generic names', () => {
    expect(preview('brand.large', '8', true, { contextProperty: 'corner-radius' }).kind).toBe('radius');
    expect(preview('brand.large', '18', true, { contextProperty: 'font-size' }).kind).toBe('font-size');
    expect(preview('brand.large', '1.4', true, { contextProperty: 'line-height' }).kind).toBe('line-height');
    expect(preview('brand.large', '8', true, { definition: { path: 'design/tokens/radius.elyx', start: 0, end: 1 } }).kind).toBe('radius');
  });

  test.each(themes)('file-controlled labels and font-family text cannot add XML, dark=%s', isDark => {
    const payload = '\"><script>alert(1)</script><image href="https://evil.test/a" onload="x"/>&';
    for (const reference of ['fonts.body', payload]) {
      const card = validPreview(createVisualPreview(item(reference, JSON.stringify(payload)), { isDark }));
      expect(card.svg).not.toContain('<script>');
      expect(card.svg).not.toContain('<image ');
      expect(card.svg).not.toContain('https://evil.test/a"');
      expect(card.svg).toContain('&lt;');
      expect(card.svg).toContain('&amp;');
    }
  });

  test('light and dark use different palettes without changing meaning', () => {
    const dark = preview('radius.lg', '8', true);
    const light = preview('radius.lg', '8', false);
    expect(dark.kind).toBe(light.kind);
    expect(dark.alt).toBe(light.alt);
    expect(dark.svg).not.toBe(light.svg);
  });

  test('nonfinite or malicious colour channels never become SVG attributes', () => {
    for (const channel of [Infinity, NaN, '1" onload="alert(1)', -1, 2]) {
      const card = createVisualPreview(item('paint', '#fff', { color: { red: channel, green: 1, blue: 1, alpha: 1 } }));
      if (card) validPreview(card);
    }
  });
});

describe('literal enrichment follows syntax and preserves resolver results', () => {
  test('input snapshots are unchanged, original occurrences stay first, and property context is added', () => {
    const path = 'page.elyx';
    const text = 'import "design/tokens/radius.elyx" as radii\nmain = frame {corner-radius: radii.radius.lg, padding: 12}';
    const index = createTokenIndex([{ path, text }, { path: 'design/tokens/radius.elyx', text: fixture('radius.elyx') }]);
    const resolved = index.scan(path);
    const snapshot = JSON.stringify(resolved);
    const enriched = enrichPreviewItems(text, path, resolved);
    expect(JSON.stringify(resolved)).toBe(snapshot);
    expect(enriched).not.toBe(resolved);
    expect(enriched[0]).toMatchObject(resolved[0]);
    expect(enriched[0].contextProperty).toBe('corner-radius');
    expect(enriched.filter(p => p.start === resolved[0].start && p.end === resolved[0].end)).toHaveLength(1);
    expect(enriched.find(p => text.slice(p.start, p.end) === '12')?.contextProperty).toBe('padding');
  });

  test('comments, keys, annotation arguments, source names and quoted expressions do not become occurrences', () => {
    const path = 'page.elyx';
    const text = `import "8px" as radii
      use "8px"
      // corner-radius: 99 radii.radius.lg
      @with-variant(88, radii.radius.lg)
      main = frame : radii.radius.lg {
        radii.radius.lg: "radii.radius.lg 77px",
        corner-radius: 8,
        quoted: '[66, radii.radius.lg],
        nested: {"55px": 12, "radii.radius.lg": 16},
        unknown: arbitrary(44),
        arithmetic: 7 + 3
      }`;
    const index = createTokenIndex([{ path, text }]);
    const enriched = enrichPreviewItems(text, path, index.scan(path));
    const snippets = enriched.map(p => text.slice(p.start, p.end));
    expect(snippets).toContain('8');
    expect(snippets).toContain('12');
    expect(snippets).toContain('16');
    expect(snippets).toContain('"radii.radius.lg 77px"');
    for (const forbidden of ['"8px"', '99', '88', '66', '"55px"', '"radii.radius.lg"', 'radii.radius.lg', '44', '7', '3', '7 + 3']) expect(snippets).not.toContain(forbidden);
    const string = enriched.find(p => text.slice(p.start, p.end) === '"radii.radius.lg 77px"');
    expect(enriched.some(p => p.start > string.start && p.end < string.end)).toBe(false);
  });

  test('aggregate aliases use supplied resolved occurrences and unresolved or executable expressions stay unresolved', () => {
    const path = 'page.elyx';
    const text = 'import "design/tokens/radius.elyx" as radii\nmain = frame {corner-radius: [radii.radius.lg, 6, 4, 2], unresolved: [missing.value, 8], call: run(8), math: 8 * 2}';
    const index = createTokenIndex([{ path, text }, { path: 'design/tokens/radius.elyx', text: fixture('radius.elyx') }]);
    const enriched = enrichPreviewItems(text, path, index.scan(path));
    const aggregate = enriched.find(p => text.slice(p.start, p.end) === '[radii.radius.lg, 6, 4, 2]');
    expect(aggregate?.value).toBe('[8, 6, 4, 2]');
    expect(createVisualPreview(aggregate).kind).toBe('radius');
    expect(enriched.some(p => text.slice(p.start, p.end) === '[missing.value, 8]')).toBe(false);
    expect(enriched.some(p => ['run(8)', '8 * 2'].includes(text.slice(p.start, p.end)))).toBe(false);
  });

  test('generic string, atom, list and map literals have complete expression spans after astral Unicode', () => {
    const path = 'page.elyx';
    const text = 'main = frame {title: "😀", label: "hello", alignment: .center, values: [1, 2], data: {answer: 42}}';
    const enriched = enrichPreviewItems(text, path, []);
    for (const value of ['"hello"', '.center', '[1, 2]', '{answer: 42}']) {
      const entry = enriched.find(p => text.slice(p.start, p.end) === value);
      expect(entry).toBeDefined();
      expect(entry.start).toBe(text.indexOf(value));
      expect(createVisualPreview(entry).kind).toBe('value');
    }
  });
});

describe('preview settings', () => {
  test('hex colour overrides replace palette entries and anything else is ignored', () => {
    const card = preview('radius.lg', '8', true);
    const custom = validPreview(createVisualPreview(item('radius.lg', '8'), { isDark: true, colors: { background: '#123456', accent: '#abc', text: 'red"/><script>', line: 42 } }));
    expect(tags(custom.svg, 'rect')[0].fill).toBe('#123456');
    expect(tags(custom.svg, 'path').some(path => path.stroke === '#abc')).toBe(true);
    expect(custom.svg).not.toContain('script');
    expect(tags(custom.svg, 'text')[0].fill).toBe(tags(card.svg, 'text')[0].fill);
  });

  test('custom sample text replaces built-in specimens and stays escaped', () => {
    const card = validPreview(createVisualPreview(item('typography.fontSize.base', '16'), { sampleText: '  Hamburgefonstiv <b>  ' }));
    expect(card.svg).toContain('Hamburgefonstiv &lt;b&gt;');
    expect(card.svg).not.toContain('Ag 012');
    expect(preview('typography.fontSize.base', '16').svg).toContain('Ag 012');
  });

  test('extra property names choose a sample kind', () => {
    expect(createVisualPreview(item('layout.gutter', '12')).kind).toBe('value');
    expect(createVisualPreview(item('layout.gutter', '12'), { kindNames: { spacing: ['gutter'] } }).kind).toBe('spacing');
    expect(createVisualPreview(item('shape.rounding', '4'), { kindNames: { radius: ['rounding'] } }).kind).toBe('radius');
    expect(createVisualPreview(item('type.bodySize', '14'), { kindNames: { 'font-size': ['bodySize'] } }).kind).toBe('font-size');
    expect(createVisualPreview(item('layout.gutter', '12'), { kindNames: { spacing: 'gutter' } }).kind).toBe('value');
  });
});

describe('more preview settings', () => {
  const colour = { color: { red: 1, green: 0, blue: 0, alpha: 0.5 } };

  test('checkerboard colours come from the palette', () => {
    const card = validPreview(createVisualPreview(item('paint', '#ff000080', colour), { colors: { checkerLight: '#010203', checkerDark: '#040506' } }));
    expect(card.svg).toContain('fill="#010203"');
    expect(card.svg).toContain('fill="#040506"');
  });

  test('larger font size limits draw bigger samples and grow the card', () => {
    const base = preview('typography.fontSize.hero', '90');
    const big = validPreview(createVisualPreview(item('typography.fontSize.hero', '90'), { maxFontSize: 90 }));
    expect(tags(base.svg, 'text').some(t => t['font-size'] === '56')).toBe(true);
    expect(tags(big.svg, 'text').some(t => t['font-size'] === '90')).toBe(true);
    expect(big.height).toBeGreaterThan(base.height);
    expect(big.alt).not.toContain('scaled');
    const tiny = validPreview(createVisualPreview(item('typography.fontSize.hero', '90'), { maxFontSize: 1 }));
    expect(tiny.alt).toContain('scaled to 8 px');
  });

  test('spacing limit sets the scale point and stays inside the card', () => {
    expect(preview('space.big', '120').alt).toContain('Measured gap at 1x');
    expect(validPreview(createVisualPreview(item('space.big', '120'), { maxSpacing: 60 })).alt).toContain('Scaled 0.5x');
    const list = validPreview(createVisualPreview(item('space.list', '[400, 10]'), { maxSpacing: 9999 }));
    expect(Math.max(...tags(list.svg, 'rect').slice(1).map(r => Number(r.x) + Number(r.width)))).toBeLessThanOrEqual(45 + 170);
  });

  test('custom weight names resolve in kebab and plain forms', () => {
    expect(createVisualPreview(item('fontWeight.body', '.book')).alt).toContain('Unsupported');
    for (const value of ['.book', '.extraHeavy', '.extraheavy']) {
      const card = validPreview(createVisualPreview(item('fontWeight.body', value), { fontWeights: { book: 450, extraHeavy: 950 } }));
      expect(card.kind).toBe('font-weight');
    }
  });

  test('sample font is sanitised before it reaches the SVG', () => {
    const card = validPreview(createVisualPreview(item('typography.fontSize.base', '16'), { fontFamily: 'Inter, "x"/><script>, system-ui' }));
    expect(card.svg).toContain('font-family="Inter, xscript, system-ui"');
    expect(card.alt).toContain('Local Inter fallback');
    expect(preview('typography.fontSize.base', '16').svg).toContain('font-family="sans-serif"');
  });

  test('long footnotes wrap onto a second line and grow the card', () => {
    const footnote = card => tags(card.svg, 'text').filter(t => t['font-size'] === '10').length;
    const short = preview('space.x3', '12');
    const long = preview('typography.fontSize.body', '16');
    expect(footnote(short)).toBe(1);
    expect(footnote(long)).toBe(2);
    expect(visible(long)).toContain('Local sans-serif fallback;');
    expect(visible(long)).toContain('illustrative metrics');
    expect(long.svg).not.toContain('...');
    const wide = validPreview(createVisualPreview(item('typography.fontWeight.book', '450'), { fontFamily: 'Iosevka Extended Fixed Wide' }));
    const narrow = preview('typography.fontWeight.book', '450');
    expect(wide.svg).not.toContain('...');
    expect([footnote(narrow), footnote(wide)]).toEqual([1, 2]);
    expect(wide.height).toBe(narrow.height + 13);
  });
});
