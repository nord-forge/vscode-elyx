const { describe, test, expect } = require('bun:test');
const { parseJsonc, themeKeyMatches, scopedColors, paletteFromThemeColors, mergeColors } = require('../../src/theme.js');

describe('editor theme colours', () => {
  test('theme files with comments, trailing commas and slashes in strings parse', () => {
    const json = parseJsonc('﻿{\n  // name\n  "name": "Demo // not a comment",\n  /* block */ "colors": {"editor.background": "#101010",},\n  "tokenColors": [1, 2,],\n}');
    expect(json).toEqual({ name: 'Demo // not a comment', colors: { 'editor.background': '#101010' }, tokenColors: [1, 2] });
  });

  test('scoped keys follow the workbench.colorCustomizations forms', () => {
    expect(themeKeyMatches('[Default Dark Modern]', 'Default Dark Modern')).toBe(true);
    expect(themeKeyMatches('[One][Default Dark Modern]', 'Default Dark Modern')).toBe(true);
    expect(themeKeyMatches('[*Dark*]', 'Default Dark Modern')).toBe(true);
    expect(themeKeyMatches('[*Light*]', 'Default Dark Modern')).toBe(false);
    expect(themeKeyMatches('[Default.Dark]', 'DefaultxDark')).toBe(false);
    expect(themeKeyMatches('editor.background', 'Default Dark Modern')).toBe(false);
  });

  test('plain keys apply to every theme and scoped keys win for the active one', () => {
    const settings = { 'editor.background': '#111111', '[Mine]': { 'editor.background': '#222222' }, '[Other]': { 'editor.background': '#333333' } };
    expect(scopedColors(settings, 'Mine')).toEqual({ 'editor.background': '#222222' });
    expect(scopedColors(settings, 'Else')).toEqual({ 'editor.background': '#111111' });
    expect(scopedColors(undefined, 'Mine')).toEqual({});
  });

  test('workbench colours map to the card palette with fallbacks', () => {
    const palette = paletteFromThemeColors({
      'editorWidget.background': '#1e1e1e', 'editor.background': '#000000', foreground: '#cccccc',
      'textLink.foreground': '#4daafc', 'editor.selectionBackground': '#264f78', 'contrastBorder': 'not a colour',
    });
    expect(palette).toEqual({ background: '#1e1e1e', text: '#cccccc', accent: '#4daafc', accentSoft: '#264f78' });
  });

  test('later layers win and invalid values never replace valid ones', () => {
    expect(mergeColors({ text: '#111' }, false, { text: 'red', accent: '#222' }, { accent: '#333333' })).toEqual({ text: '#111', accent: '#333333' });
  });
});
