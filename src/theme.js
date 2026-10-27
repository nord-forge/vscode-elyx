'use strict';

// VS Code exposes no API for resolved theme colours. Hover cards that match
// the editor read the active theme file, follow its includes and then apply
// workbench.colorCustomizations, the same layers VS Code itself uses.
const {isHexColor} = require('./previews');

// Card palette keys and the workbench colours that feed them, best match first.
const THEME_SOURCES = {
  background: ['editorHoverWidget.background', 'editorWidget.background', 'editor.background'],
  surface: ['textCodeBlock.background', 'input.background', 'editor.lineHighlightBackground'],
  text: ['editorHoverWidget.foreground', 'editorWidget.foreground', 'editor.foreground', 'foreground'],
  mutedText: ['descriptionForeground', 'editorLineNumber.foreground'],
  line: ['editorHoverWidget.border', 'editorWidget.border', 'widget.border', 'contrastBorder'],
  accent: ['textLink.foreground', 'focusBorder', 'button.background'],
  accentSoft: ['editor.selectionBackground', 'list.activeSelectionBackground'],
};

function stripJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text[i] === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      out += text.slice(start, ++i);
    } else if (text.startsWith('//', i)) {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else out += text[i++];
  }
  return out;
}

// Theme files are JSON with comments and trailing commas.
function parseJsonc(text) {
  const plain = stripJsonc(String(text).replace(/^﻿/, ''));
  let out = '';
  for (let i = 0; i < plain.length;) {
    if (plain[i] === '"') {
      const start = i++;
      while (i < plain.length && plain[i] !== '"') i += plain[i] === '\\' ? 2 : 1;
      out += plain.slice(start, ++i);
    } else if (plain[i] === ',' && /^\s*[}\]]/.test(plain.slice(i + 1))) i++;
    else out += plain[i++];
  }
  return JSON.parse(out);
}

// Matches `[Name]`, `[One][Two]` and `[*Dark*]` keys as colorCustomizations does.
function themeKeyMatches(key, themeName) {
  if (!/^(?:\[[^\]]+\])+$/.test(key)) return false;
  return key.slice(1, -1).split('][').some(pattern => {
    const source = pattern.trim().split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${source}$`, 'i').test(themeName);
  });
}

// Plain colour keys apply to every theme. Scoped keys apply after them.
function scopedColors(settings, themeName) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
  const result = {};
  for (const [key, value] of Object.entries(settings)) if (!key.startsWith('[')) result[key] = value;
  for (const [key, value] of Object.entries(settings)) {
    if (themeName && themeKeyMatches(key, themeName) && value && typeof value === 'object') Object.assign(result, value);
  }
  return result;
}

function paletteFromThemeColors(colors) {
  const palette = {};
  for (const [key, sources] of Object.entries(THEME_SOURCES)) {
    const found = sources.map(source => colors && colors[source]).find(isHexColor);
    if (found) palette[key] = found;
  }
  return palette;
}

// Later layers win. Values that are not hex colours never replace earlier ones.
function mergeColors(...layers) {
  const result = {};
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const [key, value] of Object.entries(layer)) if (isHexColor(value)) result[key] = value;
  }
  return result;
}

const UI_THEMES = {1: ['vs'], 2: ['vs-dark'], 3: ['hc-black'], 4: ['hc-light']};

function themeCandidates(vscode) {
  const workbench = vscode.workspace.getConfiguration('workbench');
  const windowConfig = vscode.workspace.getConfiguration('window');
  const kind = vscode.window.activeColorTheme.kind;
  const preferred = {
    1: 'preferredLightColorTheme', 2: 'preferredDarkColorTheme',
    3: 'preferredHighContrastColorTheme', 4: 'preferredHighContrastLightColorTheme',
  }[kind];
  const names = [workbench.get('colorTheme'), preferred && workbench.get(preferred)];
  if (windowConfig.get('autoDetectColorScheme') || kind >= 3) names.reverse();
  return [...new Set(names.filter(name => typeof name === 'string' && name))];
}

function findTheme(vscode, name, kind) {
  for (const extension of vscode.extensions.all) {
    const themes = extension.packageJSON?.contributes?.themes;
    if (!Array.isArray(themes)) continue;
    const entry = themes.find(theme => (theme.id || theme.label) === name);
    if (entry && typeof entry.path === 'string') {
      return {extension, entry, matchesKind: (UI_THEMES[kind] || []).includes(entry.uiTheme)};
    }
  }
  return undefined;
}

async function readThemeFile(vscode, uri, depth = 0) {
  if (depth > 8 || !uri.path.toLowerCase().endsWith('.json')) return {};
  const json = parseJsonc(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
  const base = typeof json.include === 'string' ? await readThemeFile(vscode, vscode.Uri.joinPath(uri, '..', json.include), depth + 1) : {};
  return {...base, ...(json.colors && typeof json.colors === 'object' ? json.colors : {})};
}

// Returns the active theme's name and its workbench colours. Unknown or
// unreadable themes give an empty colour map so the built-in palette applies.
async function loadEditorTheme(vscode, log = () => {}) {
  const kind = vscode.window.activeColorTheme.kind;
  const found = themeCandidates(vscode).map(name => ({name, theme: findTheme(vscode, name, kind)}));
  const active = found.find(item => item.theme?.matchesKind) || found.find(item => item.theme) || found[0];
  const name = active?.name;
  let colors = {};
  if (active?.theme) {
    try {
      colors = await readThemeFile(vscode, vscode.Uri.joinPath(active.theme.extension.extensionUri, active.theme.entry.path));
    } catch (error) {
      log(`Theme colours for ${name}: ${error.message || error}`);
    }
  }
  const customized = scopedColors(vscode.workspace.getConfiguration('workbench').get('colorCustomizations'), name);
  return {name, colors: {...colors, ...customized}};
}

module.exports = {parseJsonc, themeKeyMatches, scopedColors, paletteFromThemeColors, mergeColors, loadEditorTheme};
