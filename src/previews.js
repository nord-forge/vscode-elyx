'use strict';

// Illustrative hover cards only: no compiler, source execution, or file access.
const {parseFile} = require('./tokens');
const {isHexColor, parseHex, contrast, rating, ensureContrast, colorName, simulate, formatRatio} = require('./accessibility');

function enrichPreviewItems(text, documentPath, resolvedItems) {
  const parsed = parseFile(text);
  const originals = Array.isArray(resolvedItems) ? resolvedItems : [];
  const at = new Map(originals.map(item => [item.start + ':' + item.end, item]));
  const contexts = new Map(), ranges = new Map(), added = [];
  const id = node => node.start + ':' + node.end;
  const keyOf = node => node.type === 'string' ? node.value
    : node.type === 'reference' && !node.absolute && node.parts.length === 1 ? node.parts[0]
    : node.type === 'number' || node.type === 'atom' ? node.text : undefined;

  function rangesFor(node) {
    if (ranges.has(id(node))) return ranges.get(id(node));
    const span = (start, end) => ({start, end});
    let allowed = [];
    if (['number', 'length', 'string', 'atom', 'hex', 'reference'].includes(node.type)) allowed = [span(node.start, node.end)];
    else if (['map', 'list', 'group', 'call'].includes(node.type)) {
      if (node.type === 'call') {
        // The name and parentheses are meaningful call syntax, but comments
        // between the name and opening parenthesis are never hover targets.
        const nameEnd = node.start + node.name.length;
        allowed.push(span(node.start, nameEnd));
        let cursor = nameEnd;
        while (cursor < node.end) {
          if (/\s/.test(text[cursor])) cursor++;
          else if (text.slice(cursor, cursor + 2) === '//') {
            while (cursor < node.end && !/[\r\n]/.test(text[cursor])) cursor++;
          } else break;
        }
        if (text[cursor] === '(') allowed.push(span(cursor, cursor + 1));
        allowed.push(...node.args.flatMap(arg => rangesFor(arg.value)));
      } else {
        allowed.push(span(node.start, node.start + 1));
        const children = node.type === 'map' ? node.entries.map(entry => entry.value) : node.children;
        allowed.push(...children.flatMap(rangesFor));
      }
      if (node.complete) allowed.push(span(node.end - 1, node.end));
    } else if (node.type !== 'quote' && node.children) {
      // Preserve ranges for already resolved children of unsupported syntax.
      for (const child of node.children) rangesFor(child);
    }
    ranges.set(id(node), allowed);
    return allowed;
  }

  function valueOf(node) {
    const existing = at.get(id(node));
    if (existing) return existing.value;
    if (['number', 'length', 'atom'].includes(node.type)) return node.text;
    if (node.type === 'string') return JSON.stringify(node.value);
    if (node.type === 'group' && node.complete && node.children.length === 1) return valueOf(node.children[0]);
    if (node.type === 'list' && node.complete) {
      const values = node.children.map(valueOf);
      return values.every(value => typeof value === 'string') ? '[' + values.join(', ') + ']' : undefined;
    }
    if (node.type === 'map' && node.complete) {
      const entries = node.entries.map(entry => {
        const key = keyOf(entry.key), value = valueOf(entry.value);
        return key !== undefined && typeof value === 'string' ? key + ': ' + value : undefined;
      });
      return entries.every(value => value !== undefined) ? '{' + entries.join(', ') + '}' : undefined;
    }
    return undefined;
  }

  function visit(node, property, prefix) {
    if (['quote', 'unsupported', 'binary'].includes(node.type)) return;
    contexts.set(id(node), property.join('.'));
    const existing = at.get(id(node));
    // Keep whole resolved colour calls above all their implementation details.
    if (node.type === 'call') return;
    if (!existing && ['number', 'length', 'string', 'atom', 'list', 'map', 'group'].includes(node.type)) {
      const value = valueOf(node);
      if (value !== undefined) added.push({start: node.start, end: node.end,
        reference: (prefix ? prefix + '.' : '') + property.join('.'), value,
        definition: {path: documentPath, start: node.start, end: node.end},
        contextProperty: property.join('.'), hoverRanges: rangesFor(node)});
    }
    if (node.type === 'map' && node.complete) {
      for (const entry of node.entries) {
        const key = keyOf(entry.key);
        if (key !== undefined) visit(entry.value, [...property, key], prefix);
      }
    } else if (node.type === 'list' && node.complete) {
      node.children.forEach((child, index) => visit(child, [...property, index], prefix));
    } else if (node.type === 'group' && node.complete) {
      for (const child of node.children) visit(child, property, prefix);
    }
  }
  for (const expression of parsed.expressions) {
    rangesFor(expression.node);
    const group = expression.scope === null ? undefined : parsed.groups[expression.scope];
    visit(expression.node, expression.property || [], group && group.name);
  }
  return [...originals.map(item => {
    const enclosing = parsed.expressions.find(expression => expression.node.start <= item.start && expression.node.end >= item.end);
    const contextProperty = contexts.get(item.start + ':' + item.end)
      || (enclosing && (enclosing.property || []).join('.'));
    return {...item, ...(contextProperty ? {contextProperty} : {}),
      ...(ranges.has(item.start + ':' + item.end) ? {hoverRanges: ranges.get(item.start + ':' + item.end)} : {})};
  }), ...added];
}

function findPreviewItem(items, offset) {
  return items.find(item => item.start <= offset && offset < item.end
    && (!Array.isArray(item.hoverRanges) || item.hoverRanges.some(range => range.start <= offset && offset < range.end)));
}

const WIDTH = 320;
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[char]));
const short = (value, count = 43) => {
  const clean = String(value).replace(/[\x00-\x1f\x7f]/g, ' ');
  return [...clean].length > count ? [...clean].slice(0, count - 3).join('') + '...' : clean;
};
// Conservative sans-serif advances, including wide Latin and non-Latin glyphs.
const advance = (char, size) => size * (/[^\x20-\x7e]/.test(char) ? 1.3
  : /[MWmw@#%&]/.test(char) ? 1.1 : /[A-Z]/.test(char) ? 0.85
  : /[il.,:;!|' ]/.test(char) ? 0.4 : 0.8);
const textWidth = (value, size) => [...value].reduce((sum, char) => sum + advance(char, size), 0);
function fitText(value, size, width) {
  const chars = [...String(value).replace(/[\x00-\x1f\x7f]/g, ' ')];
  // Truncate content rather than changing the specimen's font size.
  if (textWidth(chars.join(''), size) <= width) return chars.join('');
  const suffix = '...', available = Math.max(0, width - advance('.', size) * 3);
  let used = 0, end = 0;
  while (end < chars.length && used + advance(chars[end], size) <= available) used += advance(chars[end++], size);
  return chars.slice(0, end).join('') + suffix;
}
// Footnotes wrap at word breaks. They break after a semicolon instead when
// the rest still fits. Only the last allowed line is truncated.
function wrapText(value, size, width, maxLines) {
  const lines = [];
  let words = String(value).replace(/[\x00-\x1f\x7f]/g, ' ').trim().split(/\s+/);
  while (words.length && lines.length < maxLines - 1) {
    let count = 1;
    while (count < words.length && textWidth(words.slice(0, count + 1).join(' '), size) <= width) count++;
    const clause = words.slice(0, count).findLastIndex(word => word.endsWith(';'));
    const restFits = lines.length < maxLines - 2 || textWidth(words.slice(clause + 1).join(' '), size) <= width;
    if (count < words.length && clause >= 0 && restFits) count = clause + 1;
    lines.push(fitText(words.slice(0, count).join(' '), size, width));
    words = words.slice(count);
  }
  if (words.length) lines.push(fitText(words.join(' '), size, width));
  return lines;
}
const number = value => Math.abs(value) < 1e12 ? Math.round(value * 1000) / 1000 : value;
const scaleLabel = value => Number(value.toPrecision(3));
function numeric(value) {
  const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([A-Za-z%-]*)\s*$/.exec(String(value));
  if (!match || !Number.isFinite(Number(match[1]))) return undefined;
  return {value: Number(match[1]), unit: match[2]};
}
// Checked in order, so earlier kinds win when a path names several.
const KIND_NAMES = {
  'font-size': ['font-size', 'fontsize'],
  'line-height': ['line-height', 'lineheight', 'leading'],
  'letter-spacing': ['letter-spacing', 'letterspacing'],
  'font-weight': ['font-weight', 'fontweight'],
  'font-family': ['fonts', 'font-family', 'fontfamily'],
  radius: ['radius', 'radii', 'corner-radius'],
  spacing: ['spacing', 'space', 'gap', 'item-gap', 'row-gap', 'column-gap', 'padding', 'margin',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
};
const kebab = value => String(value).replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

function semanticKind(item, extraNames = {}) {
  if (item.color && ['red', 'green', 'blue', 'alpha'].every(key => Number.isFinite(item.color[key]) && item.color[key] >= 0 && item.color[key] <= 1)) return 'colour';
  const parts = [item.contextProperty, item.reference, item.definition && item.definition.path]
    .filter(Boolean).flatMap(value => kebab(Array.isArray(value) ? value.join('.') : value).split(/[./\\\[\]]/));
  const has = names => parts.some(part => names.includes(part.replace(/\.elyx$/, '')));
  for (const [kind, names] of Object.entries(KIND_NAMES)) {
    const extra = extraNames && Array.isArray(extraNames[kind]) ? extraNames[kind].filter(name => typeof name === 'string' && name).map(kebab) : [];
    if (has([...names, ...extra])) return kind;
  }
  return 'value';
}

const PALETTES = {
  dark: {bg: '#202329', surface: '#2d333c', text: '#f3f5f7', muted: '#b9c3d0', line: '#8595a8', accent: '#8dc8ff', soft: '#254e72', checkerLight: '#ffffff', checkerDark: '#b7bec8'},
  light: {bg: '#ffffff', surface: '#eef2f6', text: '#17212d', muted: '#46566b', line: '#61758d', accent: '#005b9f', soft: '#d3eaff', checkerLight: '#ffffff', checkerDark: '#b7bec8'},
};
// Setting names on the left, internal palette keys on the right.
const PALETTE_KEYS = {background: 'bg', surface: 'surface', text: 'text', mutedText: 'muted', line: 'line', accent: 'accent', accentSoft: 'soft', checkerLight: 'checkerLight', checkerDark: 'checkerDark'};
const FONT_WEIGHTS = {thin: 100, 'extra-light': 200, light: 300, normal: 400, regular: 400, medium: 500, 'semi-bold': 600, semibold: 600, bold: 700, 'extra-bold': 800, black: 900};
const clamp = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const SHORT_RATING = {AAA: 'AAA', AA: 'AA', 'AA large text only': 'Large text', fails: 'Fails'};
// Short forms fit the card. Descriptions use the full names.
const VISION_LABELS = [['protanopia', 'Protan'], ['deuteranopia', 'Deutan'], ['tritanopia', 'Tritan']];

function createVisualPreview(item, {isDark = true, colors, sampleText, kindNames, fontWeights, fontFamily, maxFontSize, maxSpacing,
  minimumContrast = 'AA', highContrast = false, scale = 1, editorBackground, showContrast = true, colorVision = true} = {}) {
  if (!item || typeof item.value !== 'string') return undefined;
  // Only plain hex values reach the SVG, so settings cannot inject markup.
  const palette = {...PALETTES[isDark ? 'dark' : 'light']};
  for (const [name, key] of Object.entries(PALETTE_KEYS)) if (colors && isHexColor(colors[name])) palette[key] = colors[name];
  if (highContrast) palette.soft = palette.bg;
  // High contrast always asks for AAA. Text must also read on panels and fills.
  const level = highContrast ? 'AAA' : minimumContrast;
  if (level === 'AA' || level === 'AAA') {
    const textRatio = level === 'AAA' ? 7 : 4.5;
    palette.text = ensureContrast(palette.text, [palette.bg, palette.surface, palette.soft], textRatio);
    palette.muted = ensureContrast(palette.muted, [palette.bg], textRatio);
    palette.line = ensureContrast(palette.line, [palette.bg], 3);
    palette.accent = ensureContrast(palette.accent, [palette.bg, palette.soft], 3);
  }
  if (highContrast) palette.muted = palette.text;
  const strokeWidth = highContrast ? 2 : 1;
  const cardScale = clamp(scale, 1, 2, 1);
  const custom = typeof sampleText === 'string' ? [...sampleText.trim()].slice(0, 80).join('') : '';
  const sample = builtIn => custom || builtIn;
  // Family names, commas and spaces only. Quotes and markup never reach the SVG.
  const fallbackFont = typeof fontFamily === 'string' && fontFamily.replace(/[^\w ,-]/g, '').replace(/\s+/g, ' ').trim() || 'sans-serif';
  const fallbackName = fallbackFont.split(',')[0].trim() || 'sans-serif';
  const fontLimit = clamp(maxFontSize, 8, 96, 56);
  const spaceLimit = clamp(maxSpacing, 20, 170, 160);
  const label = short(item.reference || item.contextProperty || 'Resolved value', 42);
  const valueLabel = short(item.value, 42);
  let kind = semanticKind(item, kindNames), height = 178, content = '', note = 'Illustrative preview', summary = 'Value shown as text';
  const text = (x, y, value, size = 12, attrs = '', maxWidth = WIDTH - 16 - x) => `<text x="${x}" y="${y}" font-size="${size}" fill="${palette.text}" ${attrs}>${escape(fitText(value, size, maxWidth))}</text>`;
  const line = (x1, y1, x2, y2, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${palette.line}" stroke-width="${strokeWidth}" ${extra}/>`;
  const fallback = reason => {
    kind = 'value'; height = 138; note = reason || 'Resolved value'; summary = 'Value shown as text';
    content = `<rect x="16" y="62" width="288" height="36" rx="6" fill="${palette.surface}"/>` + text(25, 85, short(item.value, 38), 14, '', 270);
  };
  const n = numeric(item.value);

  if (kind === 'colour') {
    const c = item.color;
    const rgb = channels => [channels.red, channels.green, channels.blue].map(channel => Math.round(channel * 255)).join(',');
    content = '<defs><pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="' + palette.checkerLight + '"/><path d="M0 0h8v8H0zM8 8h8v8H8z" fill="' + palette.checkerDark + '"/></pattern><clipPath id="swatch"><rect x="16" y="61" width="288" height="80" rx="7"/></clipPath></defs>' +
      `<g clip-path="url(#swatch)"><rect x="16" y="61" width="288" height="80" fill="url(#checker)"/><rect x="16" y="61" width="288" height="80" fill="rgb(${rgb(c)})" fill-opacity="${number(c.alpha)}"/></g><rect x="16" y="61" width="288" height="80" rx="7" fill="none" stroke="${palette.line}" stroke-width="${strokeWidth}"/>`;
    let y = 151;
    summary = 'Colour swatch, ' + colorName(c);
    if (showContrast) {
      // Each chip draws "Aa" in the token colour on a common background.
      const chips = [['White', '#ffffff'], ['Black', '#000000'], ...(isHexColor(editorBackground) ? [['Editor', editorBackground]] : [])];
      const results = chips.map(([name, hex], index) => {
        const x = 16 + index * 98, ratio = contrast(c, parseHex(hex));
        content += `<rect x="${x}" y="${y}" width="92" height="30" rx="4" fill="${hex}" stroke="${palette.line}" stroke-width="${strokeWidth}"/>` +
          `<text x="${x + 10}" y="${y + 21}" font-size="16" font-weight="700" fill="rgb(${rgb(c)})" fill-opacity="${number(c.alpha)}">Aa</text>` +
          text(x, y + 45, name, 11, '', 92) + text(x, y + 59, formatRatio(ratio), 11, '', 92) + text(x, y + 73, SHORT_RATING[rating(ratio)], 11, '', 92);
        return name.toLowerCase() + ' ' + formatRatio(ratio) + ' ' + rating(ratio);
      });
      summary += '. Contrast as text: ' + results.join(', ');
      y += 86;
    }
    if (colorVision) {
      VISION_LABELS.forEach(([type, name], index) => {
        const x = 16 + index * 98, seen = simulate(c, type);
        content += `<rect x="${x}" y="${y}" width="92" height="24" rx="4" fill="url(#checker)"/><rect x="${x}" y="${y}" width="92" height="24" rx="4" fill="rgb(${rgb(seen)})" fill-opacity="${number(c.alpha)}" stroke="${palette.line}" stroke-width="${strokeWidth}"/>` +
          text(x, y + 39, name, 11, '', 92);
      });
      summary += '. Simulated for protanopia, deuteranopia and tritanopia as ' + VISION_LABELS.map(([type]) => colorName(simulate(c, type))).join(', ');
      y += 50;
    }
    height = y + 29;
    note = 'Alpha ' + number(c.alpha * 100) + '% on checkerboard';
  } else if (kind === 'radius') {
    let values;
    if (n) values = [n, n, n, n];
    else if (/^\s*\[.*\]\s*$/.test(item.value)) values = item.value.trim().slice(1, -1).split(',').map(numeric);
    if (!values || values.length !== 4 || values.some(value => !value || !['', 'px'].includes(value.unit))) fallback('Unsupported radius units or shape');
    else if (values.some(value => value.value < 0)) fallback('Negative radius cannot be illustrated');
    else {
      const authored = values.map(value => value.value);
      // CSS-style proportional reduction keeps adjacent corner sums in bounds.
      const factor = Math.min(1, ...[[0, 1, 216], [3, 2, 216], [0, 3, 76], [1, 2, 76]].map(([a, b, size]) => {
        const max = Math.max(authored[a], authored[b]);
        return max ? (size / max) / (authored[a] / max + authored[b] / max) : 1;
      }));
      const [tl, tr, br, bl] = authored.map(value => number(value * factor));
      const x = 52, y = 64, w = 216, h = 76;
      const path = `M${x + tl} ${y}H${x + w - tr}A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}V${y + h - br}A${br} ${br} 0 0 1 ${x + w - br} ${y + h}H${x + bl}A${bl} ${bl} 0 0 1 ${x} ${y + h - bl}V${y + tl}A${tl} ${tl} 0 0 1 ${x + tl} ${y}Z`;
      content = `<path d="${path}" fill="${palette.soft}" stroke="${palette.accent}" stroke-width="${strokeWidth + 1}"/>` + text(64, 105, short(authored.every(value => value === authored[0]) ? authored[0] + ' px radius' : authored.join(', ') + ' px', 30), 13, '', 192);
      summary = 'Rounded box with ' + (authored.every(value => value === authored[0]) ? authored[0] + ' px corners' : 'corners of ' + authored.join(', ') + ' px, clockwise from top left');
      note = factor < 1 ? 'Corners fitted to box; scale ' + scaleLabel(factor) + 'x' : 'Measured in pixels; box 216 x 76 px';
    }
  } else if (kind === 'spacing') {
    const list = /^\s*\[.*\]\s*$/.test(item.value) ? item.value.trim().slice(1, -1).split(',').map(numeric) : undefined;
    if (list && list.length >= 1 && list.length <= 4 && list.every(value => value && ['', 'px'].includes(value.unit) && value.value >= 0)) {
      const max = Math.max(...list.map(value => value.value)), scale = max > spaceLimit ? spaceLimit / max : 1;
      content = list.map((value, index) => {
        const y = 76 + index * 32, length = number(value.value * scale);
        return text(18, y + 4, String(index + 1), 12) + `<rect x="45" y="${y - 8}" width="${length}" height="14" rx="2" fill="${palette.accent}"/>` + line(45, y + 9, 45 + length, y + 9) + text(224, y + 4, value.value + ' px', 12);
      }).join('');
      height = 113 + list.length * 32;
      summary = list.length + ' spacing bars of ' + list.map(value => value.value + ' px').join(', ');
      note = scale < 1 ? 'Indexed values scaled ' + scaleLabel(scale) + 'x to fit' : 'Indexed spacing values measured at 1x';
    } else if (list && list.some(value => value && value.value < 0)) fallback('Negative spacing cannot be illustrated');
    else if (!n || !['', 'px'].includes(n.unit)) fallback('Unsupported spacing unit or list');
    else if (n.value < 0) fallback('Negative spacing: ' + valueLabel);
    else {
      const scale = n.value > spaceLimit ? spaceLimit / n.value : 1;
      const gap = number(n.value * scale), left = number((WIDTH - gap) / 2);
      content = `<rect x="${left - 26}" y="71" width="26" height="52" rx="4" fill="${palette.accent}"/><rect x="${left + gap}" y="71" width="26" height="52" rx="4" fill="${palette.accent}"/>` +
        line(left, 133, left + gap, 133) + line(left, 128, left, 138) + line(left + gap, 128, left + gap, 138) + text(110, 158, n.value + ' px gap');
      summary = 'Gap of ' + n.value + ' px between two blocks';
      height = 194; note = scale < 1 ? 'Scaled ' + scaleLabel(scale) + 'x to fit; authored ' + n.value + ' px' : 'Measured gap at 1x';
    }
  } else if (kind === 'font-size') {
    if (!n || !['', 'px'].includes(n.unit)) fallback('Unsupported font size unit');
    else if (n.value <= 0) fallback('Nonpositive font size: ' + valueLabel);
    else {
      const size = Math.min(fontLimit, n.value);
      // Larger limits push the baseline down so tall glyphs clear the labels.
      const baseline = number(Math.max(119, 70 + size * 0.88));
      content = text(20, baseline, sample('Ag 012'), number(size)) + line(18, baseline + 9, 300, baseline + 9) + text(20, baseline + 31, n.value + ' px');
      summary = 'Text sample drawn at ' + number(size) + ' px';
      height = number(baseline + 71); note = n.value > fontLimit ? 'Sample scaled to ' + fontLimit + ' px; local ' + fallbackName + ' fallback' : 'Local ' + fallbackName + ' fallback; illustrative metrics';
    }
  } else if (kind === 'line-height') {
    if (!n || n.unit || n.value < 0) fallback('Unsupported line height; expected nonnegative multiplier');
    else {
      const natural = (n.value === 0 ? 1.2 : n.value) * 18;
      const step = Math.max(6, Math.min(45, natural));
      content = [0, 1, 2].map(index => line(18, number(80 + index * step + 4), 301, number(80 + index * step + 4), 'stroke-dasharray="3 3"') + text(20, number(80 + index * step), sample('The quick brown fox'), 18)).join('');
      height = 212;
      summary = 'Three lines of text at ' + (n.value === 0 ? 'automatic' : n.value + 'x') + ' line height';
      note = n.value === 0 ? '0 = automatic; illustrative 1.2x local fallback' : n.value + 'x font size; ' + (step !== natural ? 'sample spacing clamped; ' : '') + '18 px local fallback';
    }
  } else if (kind === 'letter-spacing') {
    if (!n || !['', '%'].includes(n.unit)) fallback('Unsupported letter spacing; expected percent');
    else {
      const pixels = n.value / 100 * 24;
      const display = Math.max(-2, Math.min(12, pixels));
      content = text(20, 105, sample('Aa Bb Cc'), 24, `letter-spacing="${number(display)}"`) + text(20, 137, n.value + '% = ' + number(pixels) + ' px at 24 px');
      summary = 'Text sample with ' + n.value + '% letter spacing';
      height = 184; note = (pixels !== display ? 'Sample spacing clamped; ' : '') + 'Percent of font size; local fallback';
    }
  } else if (kind === 'font-family') {
    let font;
    try { font = JSON.parse(item.value); } catch (_) { /* Unquoted or aggregate values are not font names. */ }
    if (typeof font !== 'string' || !font.trim()) fallback('Expected a quoted local font name');
    else {
      // A family is always one quoted name, never CSS, a URL, or a resource.
      const family = "'" + font.replace(/[\\'\x00-\x1f\x7f]/g, '') + "', " + fallbackFont;
      content = text(20, 96, sample('Aa Bb Cc 0123'), 25, `font-family="${escape(family)}"`) + text(20, 131, short(font, 35), 13);
      summary = 'Text sample in ' + short(font, 35);
      height = 176; note = 'Local font only; ' + fallbackName + ' fallback if unavailable';
    }
  } else if (kind === 'font-weight') {
    const named = {...FONT_WEIGHTS};
    if (fontWeights && typeof fontWeights === 'object') {
      for (const [name, value] of Object.entries(fontWeights)) if (Number.isFinite(value)) named[kebab(name)] = named[name.toLowerCase()] = value;
    }
    const atom = item.value.replace(/^[."']|["']$/g, '').toLowerCase();
    const weight = n && !n.unit ? n.value : named[atom];
    if (!Number.isFinite(weight) || weight < 1 || weight > 1000) fallback('Unsupported font weight');
    else {
      content = text(20, 104, sample('Aa Bb Cc 0123'), 26, `font-weight="${weight}"`);
      summary = 'Text sample at weight ' + weight;
      height = 166; note = 'Weight ' + weight + '; local ' + fallbackName + ' fallback';
    }
  } else fallback();

  const description = `${label}: ${item.value}. ${summary}. ${note}.`;
  // Screen readers get the same facts the picture shows, in words.
  const alt = short(description, 600);
  const noteSize = highContrast ? 12 : 10;
  const noteLines = wrapText(note, noteSize, 288, 2), noteLeading = noteSize + 3;
  height += (noteLines.length - 1) * noteLeading;
  const footnote = noteLines.map((value, index) => `<text x="16" y="${height - 14 - (noteLines.length - 1 - index) * noteLeading}" font-size="${noteSize}" fill="${palette.muted}">${escape(value)}</text>`).join('');
  const border = highContrast ? `<rect x="1" y="1" width="318" height="${height - 2}" rx="8" fill="none" stroke="${palette.line}" stroke-width="2"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${number(WIDTH * cardScale)}" height="${number(height * cardScale)}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${escape(alt)}"><title>${escape(alt)}</title><rect width="320" height="${height}" rx="9" fill="${palette.bg}"/>${border}<g font-family="${escape(fallbackFont)}">${text(16, 23, label, 12, 'font-weight="700"')}${text(16, 44, valueLabel, 12)}${content}${footnote}</g></svg>`;
  return {kind, alt, description, svg, width: number(WIDTH * cardScale), height: number(height * cardScale)};
}

module.exports = {enrichPreviewItems, findPreviewItem, createVisualPreview, isHexColor};
