'use strict';

const vscode = require('vscode');
const posix = require('path').posix;
const { parseFile, createTokenIndex } = require('./tokens');
const { enrichPreviewItems, createVisualPreview, findPreviewItem, isHexColor } = require('./previews');
const { loadEditorTheme, paletteFromThemeColors, scopedColors, mergeColors } = require('./theme');
const { colorName, contrastSummary } = require('./accessibility');

const DEFAULT_DIRECTORIES = ['design/tokens', 'elyx/tokens'];
const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/.git/**', '**/vendor/**'];

function relativePath(folder, uri) {
  if (folder.uri.scheme !== uri.scheme || folder.uri.authority !== uri.authority) return undefined;
  const prefix = folder.uri.path.replace(/\/$/, '') + '/';
  return uri.path.startsWith(prefix) ? uri.path.slice(prefix.length) : undefined;
}

function importPath(documentPath, request) {
  if (!request || !request.endsWith('.elyx') || request.startsWith('/') || request.includes('://') || request.startsWith('@')) return undefined;
  const result = posix.normalize(request.startsWith('.') ? posix.join(posix.dirname(documentPath), request) : request);
  return result === '..' || result.startsWith('../') ? undefined : result;
}

function directoriesFor(uri) {
  const value = vscode.workspace.getConfiguration('elyx', uri).get('tokenDirectories', DEFAULT_DIRECTORIES);
  if (!Array.isArray(value)) return DEFAULT_DIRECTORIES;
  return [...new Set(value.filter(item => typeof item === 'string').map(item => posix.normalize(item.replaceAll('\\', '/')))
    .filter(item => item && item !== '.' && item !== '..' && !item.startsWith('../') && !item.startsWith('/') && !item.includes('://')))];
}

function excludeFor(uri) {
  const value = vscode.workspace.getConfiguration('elyx', uri).get('tokenExclude', DEFAULT_EXCLUDE);
  if (!Array.isArray(value)) return `{${DEFAULT_EXCLUDE.join(',')}}`;
  // VS Code globs cannot nest brace groups, so entries are joined into one group.
  const globs = [...new Set(value.filter(item => typeof item === 'string' && item.trim() && !/[{},]/.test(item)))];
  return globs.length ? `{${globs.join(',')}}` : null;
}

class StaleSnapshot extends Error {}

class TokenStore {
  constructor() {
    this.roots = new Map();
    this.revision = 0;
    this.snapshots = new Map();
  }

  invalidate(uri, discover = false) {
    this.revision++;
    this.snapshots.clear();
    for (const state of this.roots.values()) {
      if (uri) {
        const path = relativePath(state.folder, uri);
        if (path !== undefined) state.files.delete(path);
      } else {
        state.files.clear();
      }
      if (discover || !uri) state.discovered = false;
    }
  }

  async snapshot(document) {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return undefined;
    const documentPath = relativePath(folder, document.uri);
    if (documentPath === undefined) return undefined;
    const directories = directoriesFor(document.uri);
    const exclude = excludeFor(document.uri);
    const rootKey = folder.uri.toString();
    const signature = JSON.stringify([directories, exclude]);
    let state = this.roots.get(rootKey);
    if (!state || state.signature !== signature) {
      state = { folder, signature, files: new Map(), discovered: false, tokenPaths: [] };
      this.roots.set(rootKey, state);
    }
    const revision = this.revision;
    const version = document.version;
    const key = `${rootKey}\n${signature}\n${document.uri}\n${version}\n${revision}`;
    if (this.snapshots.has(key)) return this.snapshots.get(key);

    if (!state.discovered) {
      const found = await Promise.all(directories.map(directory => vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, `${directory}/**/*.elyx`),
        exclude,
      )));
      if (revision !== this.revision) throw new StaleSnapshot();
      state.tokenPaths = [...new Set(found.flat().map(uri => relativePath(folder, uri)).filter(path => path !== undefined))];
      state.discovered = true;
    }

    const diskFiles = new Map(state.files);
    const files = new Map(state.files);
    const buffers = new Map();
    // Only dirty buffers override disk. A clean, deleted file may still have an
    // open editor model; that model must not keep its imports alive elsewhere.
    for (const open of vscode.workspace.textDocuments) {
      const path = relativePath(folder, open.uri);
      if (path !== undefined && path.endsWith('.elyx') && open.isDirty) buffers.set(path, open.getText());
    }
    files.set(documentPath, document.getText());
    const visited = new Set();
    const load = async path => {
      if (visited.has(path)) return;
      visited.add(path);
      if (path !== documentPath && buffers.has(path)) {
        try {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, path));
          if (revision !== this.revision) throw new StaleSnapshot();
          if (!(stat.type & vscode.FileType.File)) return;
          files.set(path, buffers.get(path));
        } catch (error) {
          if (error instanceof StaleSnapshot) throw error;
          files.delete(path);
          diskFiles.delete(path);
          return;
        }
      }
      if (!files.has(path)) {
        try {
          const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, path));
          if (revision !== this.revision) throw new StaleSnapshot();
          const text = Buffer.from(bytes).toString('utf8');
          files.set(path, text);
          diskFiles.set(path, text);
        } catch (error) {
          if (error instanceof StaleSnapshot) throw error;
          return;
        }
      }
      const imports = parseFile(files.get(path)).imports;
      await Promise.all(imports.map(item => {
        const resolved = importPath(path, item.path);
        return resolved ? load(resolved) : undefined;
      }));
    };
    await Promise.all([documentPath, ...state.tokenPaths].map(load));
    if (revision !== this.revision || document.version !== version) throw new StaleSnapshot();
    const index = createTokenIndex([...files].map(([path, text]) => ({ path, text })), directories);
    const items = enrichPreviewItems(document.getText(), documentPath, index.scan(documentPath));
    const snapshot = { version, revision, documentPath, directories, items };
    // Current and dirty documents are overlays, never reusable disk cache data.
    state.files = diskFiles;
    this.snapshots.set(key, snapshot);
    return snapshot;
  }
}

function colorHex(color) {
  const byte = value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0');
  const rgb = `#${byte(color.red)}${byte(color.green)}${byte(color.blue)}`;
  return color.alpha < 1 ? rgb + byte(color.alpha) : rgb;
}

function swatchUri(color, border, checker) {
  const hex = colorHex(color);
  const stroke = isHexColor(border) ? border : '#888';
  const light = isHexColor(checker?.light) ? checker.light : '#fff';
  const dark = isHexColor(checker?.dark) ? checker.dark : '#aaa';
  // A checkerboard keeps nearly transparent tokens visible without hiding their alpha.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><defs><pattern id="c" width="6" height="6" patternUnits="userSpaceOnUse"><path fill="${light}" d="M0 0h6v6H0z"/><path fill="${dark}" d="M0 0h3v3H0zM3 3h3v3H3z"/></pattern></defs><rect x=".5" y=".5" width="13" height="13" rx="2" fill="url(#c)"/><rect x=".5" y=".5" width="13" height="13" rx="2" fill="${hex}" stroke="${stroke}"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function swatchOptions(config) {
  const size = Number(config.get('colorPreviews.size', 0.9));
  const em = `${Number.isFinite(size) ? Math.max(0.5, Math.min(2, size)) : 0.9}em`;
  const position = config.get('colorPreviews.position', 'before') === 'after' ? 'after' : 'before';
  const border = config.get('colorPreviews.borderColor', '#888888');
  const checker = config.get('colorPreviews.checkerboard');
  return color => ({ [position]: {
    contentIconPath: swatchUri(color, border, checker), width: em, height: em,
    margin: position === 'before' ? '0 0.3em 0 0' : '0 0 0 0.3em', verticalAlign: 'middle',
  } });
}

function activate(context) {
  const store = new TokenStore();
  const decoration = vscode.window.createTextEditorDecorationType({ rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed });
  const updated = new vscode.EventEmitter();
  const output = vscode.window.createOutputChannel('Elyx');
  const visibleSnapshots = new Map();
  const disposables = [decoration, updated, output];
  let timer;
  let editorTheme;
  let disposed = false;
  let renderId = 0;
  const isElyx = document => document.languageId === 'elyx';
  const range = (document, item) => new vscode.Range(document.positionAt(item.start), document.positionAt(item.end));
  const themeColors = () => editorTheme ||= loadEditorTheme(vscode, line => output.appendLine(line)).catch(error => {
    output.appendLine(`Theme colours: ${error.stack || error}`);
    return { colors: {} };
  });
  const themeChanged = () => { editorTheme = undefined; };

  async function refresh() {
    const currentRender = ++renderId;
    await Promise.all(vscode.window.visibleTextEditors.filter(editor => isElyx(editor.document)).map(async editor => {
      const document = editor.document;
      try {
        const snapshot = await store.snapshot(document);
        if (disposed || currentRender !== renderId || snapshot && (snapshot.version !== document.version || snapshot.revision !== store.revision)) return;
        const config = vscode.workspace.getConfiguration('elyx', document.uri);
        const enabled = config.get('colorPreviews.enabled', true);
        const colors = enabled ? (snapshot?.items || []).filter(item => item.color) : [];
        const render = swatchOptions(config);
        editor.setDecorations(decoration, colors.map(item => ({
          range: range(document, item),
          renderOptions: render(item.color),
        })));
        const result = { ...snapshot, version: document.version, decorationCount: colors.length, items: snapshot?.items || [] };
        visibleSnapshots.set(document.uri.toString(), result);
        updated.fire({ uri: document.uri, ...result });
      } catch (error) {
        if (error instanceof StaleSnapshot) schedule();
        else output.appendLine(`Token previews: ${error.stack || error}`);
      }
    }));
  }

  function schedule() {
    clearTimeout(timer);
    const delay = Number(vscode.workspace.getConfiguration('elyx').get('refreshDelay', 100));
    if (!disposed) timer = setTimeout(() => void refresh(), Number.isFinite(delay) ? Math.max(0, Math.min(2000, delay)) : 100);
  }

  const changed = uri => { store.invalidate(uri); schedule(); };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.elyx');
  const filesChanged = () => { store.invalidate(); schedule(); };
  disposables.push(watcher,
    watcher.onDidChange(filesChanged),
    watcher.onDidCreate(filesChanged),
    watcher.onDidDelete(filesChanged),
    vscode.workspace.onDidCreateFiles(filesChanged),
    vscode.workspace.onDidDeleteFiles(filesChanged),
    vscode.workspace.onDidRenameFiles(filesChanged),
    vscode.workspace.onDidChangeTextDocument(event => { if (event.document.uri.path.endsWith('.elyx')) changed(event.document.uri); }),
    vscode.workspace.onDidCloseTextDocument(document => { if (document.uri.path.endsWith('.elyx')) changed(document.uri); }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('workbench') || event.affectsConfiguration('window')) themeChanged();
      if (event.affectsConfiguration('elyx')) { store.invalidate(); schedule(); }
    }),
    vscode.window.onDidChangeActiveColorTheme(themeChanged),
    vscode.extensions.onDidChange(themeChanged),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { store.roots.clear(); store.invalidate(); schedule(); }),
    vscode.window.onDidChangeVisibleTextEditors(schedule),
    vscode.languages.registerHoverProvider({ language: 'elyx' }, {
      async provideHover(document, position, cancellation) {
        try {
          const snapshot = await store.snapshot(document);
          if (!snapshot || cancellation.isCancellationRequested) return undefined;
          const offset = document.offsetAt(position);
          const item = findPreviewItem(snapshot.items, offset);
          if (!item) return undefined;
          const content = new vscode.MarkdownString();
          content.isTrusted = false;
          const config = vscode.workspace.getConfiguration('elyx', document.uri);
          const kind = vscode.window.activeColorTheme.kind;
          const editorDark = kind !== vscode.ColorThemeKind.Light && kind !== vscode.ColorThemeKind.HighContrastLight;
          const theme = await themeColors();
          if (cancellation.isCancellationRequested) return undefined;
          const editorBackground = isHexColor(theme.colors['editor.background']) ? theme.colors['editor.background'] : editorDark ? '#1e1e1e' : '#ffffff';
          const visual = config.get('tokenPreviews.visualHovers', true);
          const describe = config.get('tokenPreviews.textDescriptions', 'auto');
          const described = describe === 'always' || describe === 'auto' && vscode.workspace.getConfiguration('editor').get('accessibilitySupport') === 'on';
          let preview;
          if (visual || described) {
            const mode = config.get('tokenPreviews.theme', 'editor');
            const isDark = mode === 'dark' || mode !== 'light' && editorDark;
            const contrastMode = config.get('tokenPreviews.highContrast', 'auto');
            const highContrast = contrastMode === 'on' || contrastMode === 'auto' && (kind === vscode.ColorThemeKind.HighContrast || kind === vscode.ColorThemeKind.HighContrastLight);
            // Built-in palette, then editor theme, then dark or light overrides, then per-theme overrides.
            const colors = mergeColors(
              mode === 'editor' && paletteFromThemeColors(theme.colors),
              config.get(isDark ? 'tokenPreviews.darkColors' : 'tokenPreviews.lightColors'),
              scopedColors(config.get('tokenPreviews.themeColors'), theme.name),
            );
            preview = createVisualPreview(item, {
              isDark,
              colors,
              sampleText: config.get('tokenPreviews.sampleText', ''),
              kindNames: config.get('tokenPreviews.propertyNames'),
              fontWeights: config.get('tokenPreviews.fontWeights'),
              fontFamily: config.get('tokenPreviews.fontFamily', 'sans-serif'),
              maxFontSize: config.get('tokenPreviews.maxFontSize', 56),
              maxSpacing: config.get('tokenPreviews.maxSpacing', 160),
              minimumContrast: config.get('tokenPreviews.minimumContrast', 'AA'),
              highContrast,
              scale: config.get('tokenPreviews.scale', 1),
              editorBackground,
              showContrast: config.get('tokenPreviews.showContrast', true),
              colorVision: config.get('tokenPreviews.colorVision', true),
            });
          }
          if (visual && preview) {
            const alt = preview.alt.replace(/[\\\[\]]/g, '\\$&').replace(/[\r\n]/g, ' ');
            const image = Buffer.from(preview.svg).toString('base64');
            content.appendMarkdown(`![${alt}](data:image/svg+xml;base64,${image})\n\n`);
          }
          content.appendCodeblock(`${item.reference} = ${item.value}`, 'elyx');
          if (item.color && config.get('tokenPreviews.showColorHex', true)) {
            const name = config.get('tokenPreviews.showColorName', true) ? ` (${colorName(item.color)})` : '';
            content.appendText(`\nColour: ${colorHex(item.color)}${name}`);
          }
          if (item.color && config.get('tokenPreviews.showContrast', true)) {
            content.appendText(`\nContrast as text: ${contrastSummary(item.color, [
              { label: 'white', hex: '#ffffff' }, { label: 'black', hex: '#000000' }, { label: 'editor background', hex: editorBackground },
            ])}`);
          }
          if (item.definition && config.get('tokenPreviews.showDefinition', true)) content.appendText(`\nDefined in ${item.definition.path}`);
          if (described && preview) content.appendText(`\n${preview.description}`);
          return new vscode.Hover(content, range(document, item));
        } catch (error) {
          if (!(error instanceof StaleSnapshot)) output.appendLine(`Token hover: ${error.stack || error}`);
          return undefined;
        }
      },
    }),
  );

  context.subscriptions.push({ dispose() {
    disposed = true;
    clearTimeout(timer);
    renderId++;
    for (const item of disposables) item.dispose();
  } });
  schedule();
  return {
    refresh,
    onDidUpdatePreviews: updated.event,
    getPreviewSnapshot: uri => visibleSnapshots.get(uri.toString()),
  };
}

module.exports = { activate };
