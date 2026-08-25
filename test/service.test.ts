import assert from 'node:assert/strict';
import test from 'node:test';
import { validateContent } from '../src/service.js';

function content() {
  return {
    receipt: { storyId: '3-2-b' },
    articleBlocks: [],
    imageSlots: []
  };
}

test('accepts the current imageSlots Story content contract', () => {
  assert.deepEqual(validateContent('3-2-b', content()), []);
});

test('rejects the removed imagePromptPackages-only contract', () => {
  const { imageSlots: _imageSlots, ...legacyContent } = content();
  assert.deepEqual(validateContent('3-2-b', { ...legacyContent, imagePromptPackages: [] }), [
    'content.imageSlots must be an array'
  ]);
});
