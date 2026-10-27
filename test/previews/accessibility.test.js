const { describe, test, expect } = require('bun:test');
const a11y = require('../../src/accessibility.js');
const { createVisualPreview } = require('../../src/previews.js');

const hex = value => a11y.parseHex(value);
const item = (reference, value, extra = {}) => ({ start: 0, end: value.length, reference, value, ...extra });
const fills = svg => [...svg.matchAll(/fill="(#[0-9a-f]+)"/gi)].map(m => m[1]);
const red = { red: 1, green: 0, blue: 0, alpha: 1 };

describe('contrast maths', () => {
  test('WCAG ratios and levels match known pairs', () => {
    expect(a11y.contrast(hex('#ffffff'), hex('#000000'))).toBeCloseTo(21, 5);
    expect(a11y.contrast(hex('#777777'), hex('#ffffff'))).toBeCloseTo(4.48, 2);
    expect(a11y.rating(4.48)).toBe('AA large text only');
    expect(a11y.rating(4.5)).toBe('AA');
    expect(a11y.rating(7)).toBe('AAA');
    expect(a11y.rating(2.9)).toBe('fails');
    expect(a11y.formatRatio(4.4999)).toBe('4.49:1');
  });

  test('translucent colours are measured after compositing', () => {
    expect(a11y.contrast(hex('#ffffff12'), hex('#000000'))).toBeLessThan(1.2);
    expect(a11y.contrast(hex('#ffffff12'), hex('#ffffff'))).toBeCloseTo(1, 5);
  });

  test('ensureContrast keeps passing colours and repairs failing ones', () => {
    expect(a11y.ensureContrast('#f3f5f7', ['#202329'], 4.5)).toBe('#f3f5f7');
    const fixed = a11y.ensureContrast('#444444', ['#202329'], 4.5);
    expect(a11y.contrast(hex(fixed), hex('#202329'))).toBeGreaterThanOrEqual(4.5);
    expect(a11y.parseHex(fixed).red).toBeGreaterThan(a11y.parseHex('#444444').red);
    const darker = a11y.ensureContrast('#bbbbbb', ['#ffffff', '#eef2f6'], 7);
    expect(Math.min(a11y.contrast(hex(darker), hex('#ffffff')), a11y.contrast(hex(darker), hex('#eef2f6')))).toBeGreaterThanOrEqual(7);
  });

  test('summary lists every background', () => {
    expect(a11y.contrastSummary(hex('#000000'), [{ label: 'white', hex: '#ffffff' }, { label: 'editor', hex: '#1e1e1e' }]))
      .toBe('21:1 on white (AAA), 1.25:1 on editor (fails)');
  });
});

describe('colour names and vision simulation', () => {
  test.each([
    ['#ff0000', 'vivid red'], ['#ffffff', 'white'], ['#000000', 'black'], ['#808080', 'grey'],
    ['#8b4513', 'brown'], ['#000080', 'dark blue'], ['#ffb6c1', 'pale pink'], ['#2e8b57', 'dark green'], ['#8b0000', 'dark red'], ['#b4a7d6', 'light purple'], ['#6b6f8a', 'muted blue'],
    ['#ffffff12', 'white, 7% opacity'],
  ])('%s is %s', (value, name) => expect(a11y.colorName(hex(value))).toBe(name));

  test('greys stay grey and red loses its red-green contrast under protanopia', () => {
    for (const type of Object.keys(a11y.VISION)) {
      const grey = a11y.simulate(hex('#808080'), type);
      expect(Math.abs(grey.red - grey.green)).toBeLessThan(0.02);
    }
    const seen = a11y.simulate(red, 'protanopia');
    expect(Math.abs(seen.red - seen.green)).toBeLessThan(0.2);
    expect(a11y.simulate(hex('#ff000080'), 'tritanopia').alpha).toBeCloseTo(128 / 255, 5);
  });
});

describe('accessible cards', () => {
  test.each([true, false])('built-in palettes already pass AA and AAA, dark=%s', isDark => {
    const off = createVisualPreview(item('radius.lg', '8'), { isDark, minimumContrast: 'off' });
    for (const level of ['AA', 'AAA']) expect(fills(createVisualPreview(item('radius.lg', '8'), { isDark, minimumContrast: level }).svg)).toEqual(fills(off.svg));
  });

  test('the contrast guard repairs low contrast overrides unless turned off', () => {
    const colors = { background: '#202329', text: '#333333', mutedText: '#2a2a2a', line: '#252525' };
    const guarded = createVisualPreview(item('radius.lg', '8'), { colors });
    const textFill = guarded.svg.match(/<text[^>]*fill="(#[0-9a-f]+)"/)[1];
    expect(a11y.contrast(hex(textFill), hex('#202329'))).toBeGreaterThanOrEqual(4.5);
    expect(guarded.svg).not.toContain('#2a2a2a');
    const raw = createVisualPreview(item('radius.lg', '8'), { colors, minimumContrast: 'off' });
    expect(raw.svg).toContain('fill="#333333"');
  });

  test('high contrast cards add a border, thicker lines and larger footnotes', () => {
    const normal = createVisualPreview(item('space.x3', '12'));
    const high = createVisualPreview(item('space.x3', '12'), { highContrast: true });
    expect(normal.svg).not.toContain('stroke-width="2"/></g>');
    expect(high.svg).toMatch(/<rect x="1" y="1" width="318"[^>]*stroke-width="2"/);
    expect(high.svg).toContain('<line x1=');
    expect([...high.svg.matchAll(/<line [^>]*stroke-width="(\d)"/g)].every(m => m[1] === '2')).toBe(true);
    expect(high.svg).toMatch(/font-size="12" fill="[^"]+">Measured gap/);
  });

  test('scale enlarges the image without changing its drawing', () => {
    const base = createVisualPreview(item('radius.lg', '8'));
    const big = createVisualPreview(item('radius.lg', '8'), { scale: 1.5 });
    expect(big.width).toBe(480);
    expect(big.height).toBe(base.height * 1.5);
    expect(big.svg).toContain(`viewBox="0 0 320 ${base.height}"`);
    expect(createVisualPreview(item('radius.lg', '8'), { scale: 9 }).width).toBe(640);
  });

  test('colour cards show contrast chips, vision strip and a written description', () => {
    const card = createVisualPreview(item('brand.red', '#ff0000', { color: red }), { editorBackground: '#1e1e1e' });
    for (const text of ['>White<', '>3.99:1<', '>Black<', '>5.25:1<', '>Editor<', '>4.16:1<', '>Large text<', '>AA<', '>Protan<', '>Deutan<', '>Tritan<']) expect(card.svg).toContain(text);
    expect(card.svg).not.toContain('...');
    expect(card.description).toContain('Colour swatch, vivid red');
    expect(card.description).toContain('white 3.99:1 AA large text only');
    expect(card.description).toContain('Simulated for protanopia, deuteranopia and tritanopia');
    expect(card.svg).toContain('<title>brand.red: #ff0000.');
    const plain = createVisualPreview(item('brand.red', '#ff0000', { color: red }), { showContrast: false, colorVision: false });
    expect(plain.svg).not.toContain('Protan');
    expect(plain.svg).not.toContain('5.25:1');
    expect(plain.height).toBe(180);
    expect(createVisualPreview(item('brand.red', '#ff0000', { color: red })).svg).not.toContain('Editor');
  });

  test('every sample kind has a written summary', () => {
    for (const [reference, value, words] of [
      ['radius.lg', '8', 'Rounded box with 8 px corners'], ['space.x3', '12', 'Gap of 12 px'],
      ['space.list', '[4, 8]', '2 spacing bars of 4 px, 8 px'], ['fontSize.base', '16', 'Text sample drawn at 16 px'],
      ['lineHeight.normal', '1.5', 'Three lines of text at 1.5x'], ['letterSpacing.wide', '2%', '2% letter spacing'],
      ['fonts.body', '"Inter"', 'Text sample in Inter'], ['fontWeight.bold', '700', 'weight 700'], ['misc.flag', '.on', 'Value shown as text'],
    ]) expect(createVisualPreview(item(reference, value)).description).toContain(words);
  });
});
