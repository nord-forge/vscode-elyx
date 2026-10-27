const { describe, test, expect } = require('bun:test');
const { createTokenIndex } = require('../../src/tokens.js');
const { enrichPreviewItems, findPreviewItem } = require('../../src/previews.js');

function itemsFor(text) {
  const path = 'page.elyx';
  const index = createTokenIndex([{ path, text }]);
  return enrichPreviewItems(text, path, index.scan(path));
}

describe('independent aggregate hover review regressions', () => {
  test('a statically resolved map does not create a hover on its property keys', () => {
    const text = 'main = frame {data: {answer: 42, "label": "hello"}}';
    const items = itemsFor(text);
    expect(items.some(item => text.slice(item.start, item.end) === '{answer: 42, "label": "hello"}')).toBe(true);
    for (const key of ['data', 'answer', '"label"']) {
      const start = text.indexOf(key);
      for (let offset = start; offset < start + key.length; offset++) {
        expect(findPreviewItem(items, offset)).toBeUndefined();
      }
    }
    expect(findPreviewItem(items, text.indexOf('42'))).toBeDefined();
    expect(findPreviewItem(items, text.indexOf('"hello"') + 1)).toBeDefined();
  });

  test('a list aggregate does not create a hover on comments or inter-value whitespace', () => {
    const text = 'main = frame {padding: [12, // private comment\n  24]}';
    const items = itemsFor(text);
    expect(items.some(item => item.value === '[12, 24]')).toBe(true);
    const commentStart = text.indexOf('//');
    const secondValue = text.indexOf('24');
    for (let offset = commentStart; offset < secondValue; offset++) {
      expect(findPreviewItem(items, offset)).toBeUndefined();
    }
    expect(findPreviewItem(items, text.indexOf('12'))).toBeDefined();
    expect(findPreviewItem(items, secondValue)).toBeDefined();
    expect(findPreviewItem(items, text.indexOf('['))?.value).toBe('[12, 24]');
    expect(findPreviewItem(items, text.indexOf(']'))?.value).toBe('[12, 24]');
  });

  test('a resolved color call does not create a hover over an internal comment', () => {
    const text = 'main = frame {fill: rgb(100%, // channel comment\n  0%, 0%)}';
    const items = itemsFor(text);
    expect(items.some(item => item.color)).toBe(true);
    const commentStart = text.indexOf('//');
    const commentEnd = text.indexOf('\n');
    for (let offset = commentStart; offset < commentEnd; offset++) {
      expect(findPreviewItem(items, offset)).toBeUndefined();
    }
    expect(findPreviewItem(items, text.indexOf('100%'))?.color).toBeDefined();
  });
});
