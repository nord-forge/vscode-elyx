'use strict';

// Colour maths for accessible previews: WCAG contrast, contrast repair, plain
// colour names and colour vision simulation. Colours are {red, green, blue,
// alpha} with channels from 0 to 1, the same shape the token resolver uses.

const isHexColor = value => typeof value === 'string' && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);

function parseHex(value) {
  if (!isHexColor(value)) return undefined;
  let hex = value.slice(1);
  if (hex.length <= 4) hex = [...hex].map(char => char + char).join('');
  const byte = index => parseInt(hex.slice(index, index + 2), 16) / 255;
  return {red: byte(0), green: byte(2), blue: byte(4), alpha: hex.length === 8 ? byte(6) : 1};
}

function toHex(color) {
  const byte = value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0');
  const rgb = '#' + byte(color.red) + byte(color.green) + byte(color.blue);
  return color.alpha < 1 ? rgb + byte(color.alpha) : rgb;
}

// Places a translucent colour on an opaque background.
function composite(color, background) {
  const a = color.alpha;
  return {
    red: color.red * a + background.red * (1 - a),
    green: color.green * a + background.green * (1 - a),
    blue: color.blue * a + background.blue * (1 - a),
    alpha: 1,
  };
}

const linear = channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const gamma = channel => channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
const luminance = color => 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue);

function contrast(foreground, background) {
  const bg = background.alpha < 1 ? composite(background, {red: 0, green: 0, blue: 0, alpha: 1}) : background;
  const fg = foreground.alpha < 1 ? composite(foreground, bg) : foreground;
  const [high, low] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

// WCAG 2.2 text levels. 3:1 is the floor for large text and graphics.
function rating(ratio) {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA large text only';
  return 'fails';
}

const WHITE = {red: 1, green: 1, blue: 1, alpha: 1};
const BLACK = {red: 0, green: 0, blue: 0, alpha: 1};
const mix = (a, b, amount) => ({
  red: a.red + (b.red - a.red) * amount,
  green: a.green + (b.green - a.green) * amount,
  blue: a.blue + (b.blue - a.blue) * amount,
  alpha: 1,
});

// Moves a foreground towards white or black until it reaches the ratio
// against every background. The first background decides the direction.
// Colours that already pass come back unchanged.
function ensureContrast(foreground, backgrounds, ratio) {
  const fg = parseHex(foreground);
  const bgs = backgrounds.map(parseHex).filter(Boolean);
  if (!fg || !bgs.length) return foreground;
  const base = bgs[0].alpha < 1 ? composite(bgs[0], BLACK) : bgs[0];
  const layers = bgs.map(bg => bg.alpha < 1 ? composite(bg, base) : bg);
  const worst = color => Math.min(...layers.map(bg => contrast(color, bg)));
  if (worst(fg) >= ratio) return foreground;
  const start = fg.alpha < 1 ? composite(fg, base) : fg;
  const target = contrast(WHITE, base) >= contrast(BLACK, base) ? WHITE : BLACK;
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(start, target, step / 20);
    if (worst(candidate) >= ratio) return toHex(candidate);
  }
  return toHex(target);
}

function hsl(color) {
  const {red, green, blue} = color;
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (!delta) return {hue: 0, saturation: 0, lightness};
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return {hue, saturation, lightness};
}

const HUES = [[15, 'red'], [45, 'orange'], [70, 'yellow'], [95, 'yellow-green'], [155, 'green'],
  [190, 'teal'], [255, 'blue'], [290, 'purple'], [335, 'pink'], [360, 'red']];

// A short plain-language name, such as "dark orange" or "light grey".
function colorName(color) {
  const {hue, saturation, lightness} = hsl(color);
  let name;
  if (lightness > 0.94) name = 'white';
  else if (lightness < 0.06) name = 'black';
  else if (saturation < 0.12) name = lightness > 0.7 ? 'light grey' : lightness < 0.3 ? 'dark grey' : 'grey';
  else {
    let base = HUES.find(([limit]) => hue < limit)[1];
    // Light reds read as pink. Dark oranges and yellows read as brown.
    if (base === 'red' && lightness > 0.75) base = 'pink';
    if ((base === 'orange' || base === 'yellow') && lightness < 0.4) name = 'brown';
    else {
      const shade = lightness < 0.2 ? 'very dark ' : lightness < 0.38 ? 'dark ' : lightness > 0.85 ? 'pale ' : lightness > 0.68 ? 'light ' : '';
      const strength = !shade && saturation > 0.8 ? 'vivid ' : saturation < 0.3 ? 'muted ' : '';
      name = shade + strength + base;
    }
  }
  return color.alpha < 1 ? `${name}, ${Math.round(color.alpha * 100)}% opacity` : name;
}

// Machado, Oliveira and Fernandes (2009) matrices at full severity, in linear RGB.
const VISION = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};

function simulate(color, type) {
  const matrix = VISION[type];
  if (!matrix) return color;
  const input = [color.red, color.green, color.blue].map(linear);
  const [red, green, blue] = matrix.map(row => gamma(Math.max(0, Math.min(1, row[0] * input[0] + row[1] * input[1] + row[2] * input[2]))));
  return {red, green, blue, alpha: color.alpha};
}

const formatRatio = ratio => (Math.floor(ratio * 100) / 100).toString() + ':1';

// One line per background, such as "4.52:1 on white (AA)".
function contrastSummary(color, backgrounds) {
  return backgrounds.map(({label, hex}) => {
    const bg = parseHex(hex);
    if (!bg) return undefined;
    const ratio = contrast(color, bg);
    return `${formatRatio(ratio)} on ${label} (${rating(ratio)})`;
  }).filter(Boolean).join(', ');
}

module.exports = {isHexColor, parseHex, toHex, composite, contrast, rating, ensureContrast, colorName, simulate, contrastSummary, formatRatio, VISION};
