'use strict';
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

exports.run = async function () {
  const root = process.env.ELYX_COLOR_TEST_ROOT;
  const result = { passed: [], failed: null };
  const uri = relative => vscode.Uri.file(path.join(root, relative));
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (predicate, message) => {
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      const value = await predicate();
      if (value) return value;
      await pause(40);
    }
    throw new Error(`Timed out: ${message}`);
  };
  try {
    const extension = vscode.extensions.getExtension('nickbevers.elyx');
    assert(extension, 'Development extension registered');
    const api = await extension.activate();
    result.workspace = vscode.workspace.workspaceFolders.map(folder => folder.uri.toString());
    result.fileEvents = [];
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.elyx');
    watcher.onDidDelete(uri => result.fileEvents.push({ event: 'delete', uri: uri.toString() }));
    watcher.onDidCreate(uri => result.fileEvents.push({ event: 'create', uri: uri.toString() }));
    const document = await vscode.workspace.openTextDocument(uri('design/controls/preview.elyx'));
    assert.equal(document.languageId, 'elyx');
    await vscode.window.showTextDocument(document);
    const current = () => api.getPreviewSnapshot(document.uri);
    await waitFor(() => current()?.decorationCount === 3, 'three token swatches');
    result.passed.push('Activation, automatic .elyx association and three resolved token swatches');
    assert.deepEqual(current().directories, ['design/tokens', 'elyx/tokens']);
    assert.equal(current().items.find(item => item.reference === 'radii.radius.lg').value, '8px');
    assert.equal(current().items.find(item => item.reference === 'spaces.space.x3').value, '12px');
    result.passed.push('Both default folders and non-colour token values');

    const token = current().items.find(item => item.reference === 'colors.effects.whiteAlpha7');
    assert.equal(token.color.alpha, 18 / 255);
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, document.positionAt(token.start + 2));
    const hoverText = hovers.flatMap(hover => hover.contents).map(content => typeof content === 'string' ? content : content.value).join('\n');
    result.hoverText = hoverText;
    assert(hoverText.includes('#ffffff12'), `Expected resolved colour hover, got ${hoverText}`);
    result.passed.push('Actual registered hover provider reports alpha hex and definition');

    const hoverCard = async (targetDocument, offset) => {
      return waitFor(async () => {
        const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', targetDocument.uri, targetDocument.positionAt(offset));
        const text = hovers.flatMap(hover => hover.contents).map(content => typeof content === 'string' ? content : content.value).join('\n');
        const image = text.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/);
        return image ? { text, svg: Buffer.from(image[1], 'base64').toString('utf8') } : undefined;
      }, 'visual hover image');
    };
    for (const [reference, meaning] of [
      ['radii.radius.lg', 'radius'], ['spaces.space.x3', 'gap'],
      ['typography.fontSize.base', '16'], ['typography.fonts.body', 'Menlo'],
      ['typography.lineHeight.normal', '1.6'], ['typography.letterSpacing.wide', '2%'],
    ]) {
      const position = document.getText().indexOf(reference);
      assert(position >= 0, reference);
      const card = await hoverCard(document, position + 2);
      assert(card.svg.includes(meaning), `Missing ${meaning} sample for ${reference}`);
      assert(!/<script|<foreignObject|https?:\/\//i.test(card.svg.replace('http://www.w3.org/2000/svg', '')));
    }
    result.passed.push('Registered hovers include radius, spacing, font size/family, line height and letter spacing graphics');
    assert(hoverText.includes('data:image/svg+xml;base64,'));
    result.passed.push('Colour hover includes a larger checkerboard image');

    const radiusDoc = await vscode.workspace.openTextDocument(uri('elyx/tokens/radii.elyx'));
    const literalCard = await hoverCard(radiusDoc, radiusDoc.getText().indexOf('8px') + 1);
    assert(literalCard.svg.includes('radius'));
    assert(literalCard.text.includes('radius.lg'));
    assert.equal(radiusDoc.isDirty, false);
    result.passed.push('Token definition literals have visual cards without editing the definition');

    const visualSettings = vscode.workspace.getConfiguration('elyx', document.uri);
    await visualSettings.update('tokenPreviews.visualHovers', false, vscode.ConfigurationTarget.Workspace);
    await waitFor(async () => {
      const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, document.positionAt(token.start + 2));
      const text = hovers.flatMap(hover => hover.contents).map(content => typeof content === 'string' ? content : content.value).join('\n');
      return text.includes('#ffffff12') && !text.includes('data:image/');
    }, 'visual setting disables images and retains values');
    await visualSettings.update('tokenPreviews.visualHovers', undefined, vscode.ConfigurationTarget.Workspace);
    await hoverCard(document, token.start + 2);
    result.passed.push('Visual hover setting toggles images while keeping resolved values');
    for (const excluded of ['fakeKey', 'marker-preview-comment']) {
      const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, document.positionAt(document.getText().indexOf(excluded) + 2));
      assert.equal(hovers.length, 0, `No aggregate hover over ${excluded}`);
    }
    result.passed.push('Aggregate cards do not appear on map keys or comments');

    const colorUri = uri('design/tokens/colors.elyx');
    const colorDoc = await vscode.workspace.openTextDocument(colorUri);
    const original = colorDoc.getText();
    const edit = new vscode.WorkspaceEdit();
    edit.replace(colorUri, new vscode.Range(colorDoc.positionAt(0), colorDoc.positionAt(original.length)), original.replace('#ffffff12', '#ff000080'));
    assert(await vscode.workspace.applyEdit(edit));
    await waitFor(() => current()?.items.find(item => item.reference === 'colors.effects.whiteAlpha7')?.color.red === 1 && current()?.items.find(item => item.reference === 'colors.effects.whiteAlpha7')?.color.green === 0, 'unsaved token edit refresh');
    assert.equal(document.isDirty, false, 'Preview never edits the consumer document');
    result.passed.push('Unsaved token edit refreshes consumer automatically without changing references');
    const restore = new vscode.WorkspaceEdit();
    restore.replace(colorUri, new vscode.Range(colorDoc.positionAt(0), colorDoc.positionAt(colorDoc.getText().length)), original);
    await vscode.workspace.applyEdit(restore);
    await colorDoc.save();
    await waitFor(() => current()?.items.find(item => item.reference === 'colors.effects.whiteAlpha7')?.color.green === 1, 'restored colour');

    const config = vscode.workspace.getConfiguration('elyx', document.uri);
    await config.update('colorPreviews.enabled', false, vscode.ConfigurationTarget.Workspace);
    await waitFor(() => current()?.decorationCount === 0, 'disable swatches');
    await config.update('colorPreviews.enabled', true, vscode.ConfigurationTarget.Workspace);
    await waitFor(() => current()?.decorationCount === 3, 'enable swatches');
    result.passed.push('Live configuration toggle clears and restores decorations');

    await config.update('tokenDirectories', ['design/tokens'], vscode.ConfigurationTarget.Workspace);
    await waitFor(() => current() && !current().items.some(item => item.reference === 'radii.radius.lg'), 'removed folder drops fallback');
    await config.update('tokenDirectories', undefined, vscode.ConfigurationTarget.Workspace);
    await waitFor(() => current()?.items.some(item => item.reference === 'radii.radius.lg'), 'default folder restored');
    result.passed.push('Changing tokenDirectories drops and restores fallback values');

    await config.update('tokenExclude', ['**/elyx/tokens/**'], vscode.ConfigurationTarget.Workspace);
    await waitFor(() => current() && !current().items.some(item => item.reference === 'radii.radius.lg'), 'excluded folder drops fallback');
    await config.update('tokenExclude', undefined, vscode.ConfigurationTarget.Workspace);
    await waitFor(() => current()?.items.some(item => item.reference === 'radii.radius.lg'), 'exclude restored');
    result.passed.push('Changing tokenExclude drops and restores fallback values');

    const hoverTextAt = async offset => {
      const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, document.positionAt(offset));
      return hovers.flatMap(hover => hover.contents).map(content => typeof content === 'string' ? content : content.value).join('\n');
    };
    await config.update('tokenPreviews.showColorHex', false, vscode.ConfigurationTarget.Workspace);
    await config.update('tokenPreviews.showDefinition', false, vscode.ConfigurationTarget.Workspace);
    await waitFor(async () => {
      const text = await hoverTextAt(token.start + 2);
      return text.includes('colors.effects.whiteAlpha7') && text.includes('#ffffff12') && !text.includes('Colour:') && !text.includes('Defined');
    }, 'hover hides hex line and definition');
    await config.update('tokenPreviews.showColorHex', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('tokenPreviews.showDefinition', undefined, vscode.ConfigurationTarget.Workspace);
    await waitFor(async () => (await hoverTextAt(token.start + 2)).includes('Colour:'), 'hover hex line restored');
    result.passed.push('Hover hex and definition lines follow their settings');

    const cardBackground = svg => svg.match(/<rect width="320" height="[\d.]+" rx="9" fill="(#[0-9a-fA-F]+)"/)?.[1];
    result.editorThemeBackground = cardBackground((await hoverCard(document, token.start + 2)).svg);
    assert(result.editorThemeBackground && result.editorThemeBackground !== '#202329', `Expected a theme colour, got ${result.editorThemeBackground}`);
    const workbench = vscode.workspace.getConfiguration('workbench');
    await workbench.update('colorCustomizations', { 'editorHoverWidget.background': '#123123' }, vscode.ConfigurationTarget.Workspace);
    await config.update('tokenPreviews.themeColors', { '[*]': { accent: '#abcdef' } }, vscode.ConfigurationTarget.Workspace);
    await waitFor(async () => {
      const svg = (await hoverCard(document, document.getText().indexOf('radii.radius.lg') + 2)).svg;
      return cardBackground(svg) === '#123123' && svg.includes('stroke="#abcdef"');
    }, 'colour customizations and per-theme overrides reach the card');
    await workbench.update('colorCustomizations', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('tokenPreviews.themeColors', undefined, vscode.ConfigurationTarget.Workspace);
    result.passed.push('Hover cards follow the editor theme, colour customizations and per-theme overrides');

    const a11yText = await hoverTextAt(token.start + 2);
    assert(a11yText.includes('opacity') && a11yText.includes('Contrast') && a11yText.includes('fails'), `Expected colour name and contrast, got ${a11yText}`);
    assert(!a11yText.split('```').pop().includes('Simulated'), 'Descriptions stay off without accessibility support');
    await config.update('tokenPreviews.textDescriptions', 'always', vscode.ConfigurationTarget.Workspace);
    await config.update('tokenPreviews.highContrast', 'on', vscode.ConfigurationTarget.Workspace);
    await config.update('tokenPreviews.scale', 2, vscode.ConfigurationTarget.Workspace);
    await waitFor(async () => {
      const card = await hoverCard(document, token.start + 2);
      return card.text.split('```').pop().includes('Simulated') && card.svg.includes('width="640"') && card.svg.includes('<rect x="1" y="1" width="318"');
    }, 'descriptions, high contrast and scale reach the hover');
    for (const key of ['textDescriptions', 'highContrast', 'scale']) await config.update(`tokenPreviews.${key}`, undefined, vscode.ConfigurationTarget.Workspace);
    result.passed.push('Hover shows colour names and contrast, and accessibility settings change the card');

    await config.update('tokenPreviews.theme', 'light', vscode.ConfigurationTarget.Workspace);
    await config.update('tokenPreviews.lightColors', { background: '#fedcba' }, vscode.ConfigurationTarget.Workspace);
    await waitFor(async () => (await hoverCard(document, token.start + 2)).svg.includes('fill="#fedcba"'), 'forced light card with custom background');
    await config.update('tokenPreviews.theme', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('tokenPreviews.lightColors', undefined, vscode.ConfigurationTarget.Workspace);
    result.passed.push('Hover card theme and colour overrides apply');

    const fallback = uri('elyx/tokens/radii.elyx');
    result.beforeDelete = { revision: current().revision, directories: current().directories };
    await vscode.workspace.fs.delete(fallback);
    await waitFor(() => current() && !current().items.some(item => item.reference === 'radii.radius.lg'), 'deleted token file');
    await vscode.workspace.fs.writeFile(fallback, Buffer.from('export radius = tokens { lg: 10px }\n'));
    await waitFor(() => current()?.items.some(item => item.reference === 'radii.radius.lg' && item.value === '10px'), 'created token file');
    result.passed.push('Token file deletion and creation refresh without reopening the consumer');

    // No colour picker provider is registered for references. Decorations and
    // hovers supply no edits or commands that could replace a token expression.
    const native = await vscode.commands.executeCommand('vscode.executeDocumentColorProvider', document.uri);
    assert(!native?.length);
    assert.equal(document.getText().includes('fill: colors.effects.whiteAlpha7'), true);
    result.passed.push('Read-only token references have no native colour replacement edits');
    await vscode.window.showTextDocument(document);
    await api.refresh();
    console.log('ELYX COLOUR HOST PASS: ' + result.passed.length + ' integration checks');
    if (process.env.ELYX_COLOR_VISUAL === '1') {
      console.log('ELYX COLOUR PREVIEW READY FOR VISUAL REVIEW');
      await pause(45000);
    }
  } catch (error) {
    result.failed = error.stack || String(error);
    throw error;
  } finally {
    fs.writeFileSync(process.env.ELYX_COLOR_TEST_RESULT, JSON.stringify(result, null, 2));
  }
};
