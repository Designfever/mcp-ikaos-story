import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deleteStoryImage,
  listStoryImages,
  updateStoryImage,
  uploadStoryImage
} from '../src/image-service.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function fixture() {
  const root = path.join(os.tmpdir(), `mcp-ikaos-image-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  const imagePath = path.join(root, 'designer.png');
  await writeFile(imagePath, PNG);
  return { root, imagePath };
}

const environment = {
  IKAOS_STORY_API_URL: 'https://story.test',
  IKAOS_STORY_API_TOKEN: 'story-secret',
  DF_SHEET_URL: 'https://df-sheet.test',
  DF_SHEET_PROJECT_ID: 'project-1',
  DF_SHEET_ACCESS_TOKEN: 'image-secret'
};

function storyContext() {
  return {
    id: 'P-1-a',
    route: '/story/catalog/p-1-a',
    currentData: {
      revision: 'a'.repeat(64),
      updatedAt: null,
      data: { imagePromptPackages: [{ inputBrief: { slotId: 'basic-image-01' } }] }
    }
  };
}

function success(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('lists a valid Story slot with project-scoped authorization', async () => {
  let imageRequest: { url: string; init?: RequestInit } | undefined;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://story.test')) return success(storyContext());
    imageRequest = { url, init };
    return success([]);
  };
  const result = await listStoryImages(
    { storyId: 'p-1-A', slotId: 'basic-image-01' },
    { env: environment, fetchImpl }
  );
  assert.equal(result.storyId, 'P-1-a');
  assert.deepEqual(result.images, []);
  assert.equal(
    imageRequest?.init?.headers && (imageRequest.init.headers as Record<string, string>).Authorization,
    'Bearer image-secret'
  );
  const target = JSON.parse(new URL(imageRequest?.url || '').searchParams.get('target') || '{}');
  assert.deepEqual(target, {
    type: 'route', projectId: 'project-1', pageUrl: '/story/catalog/p-1-a', slot: 'basic-image-01'
  });
});

test('uploads a local image as a data URL', async (t) => {
  const local = await fixture();
  t.after(() => rm(local.root, { recursive: true, force: true }));
  let body: Record<string, unknown> = {};
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('https://story.test')) return success(storyContext());
    body = JSON.parse(String(init?.body));
    return success({ id: 'figma-new', target: body.target, imageUrl: 'https://assets.test/new.webp', order: 0 }, 201);
  };
  const result = await uploadStoryImage(
    { storyId: 'P-1-a', slotId: 'basic-image-01', imagePath: local.imagePath, label: 'Hero' },
    { env: environment, fetchImpl }
  );
  assert.equal(result.image.id, 'figma-new');
  assert.equal(body.label, 'Hero');
  assert.match((body.asset as { dataUrl: string }).dataUrl, /^data:image\/png;base64,/);
});

test('replaces only after upload succeeds, then deletes the original', async (t) => {
  const local = await fixture();
  t.after(() => rm(local.root, { recursive: true, force: true }));
  const imageMethods: string[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('https://story.test')) return success(storyContext());
    const method = init?.method || 'GET';
    imageMethods.push(method);
    if (method === 'GET') return success([{ id: 'old', imageUrl: 'old.webp', label: 'Old', order: 3 }]);
    if (method === 'POST') return success({ id: 'new', imageUrl: 'new.webp', label: 'Old', order: 3 }, 201);
    return success({ id: 'old' });
  };
  const result = await updateStoryImage(
    { storyId: 'P-1-a', slotId: 'basic-image-01', imageId: 'old', imagePath: local.imagePath },
    { env: environment, fetchImpl }
  );
  assert.deepEqual(imageMethods, ['GET', 'POST', 'DELETE']);
  assert.equal(result.replaced, true);
});

test('refuses deletion when the image is outside the requested Story slot', async () => {
  const fetchImpl = async (input: string | URL | Request) =>
    String(input).startsWith('https://story.test') ? success(storyContext()) : success([]);
  await assert.rejects(
    () => deleteStoryImage(
      { storyId: 'P-1-a', slotId: 'basic-image-01', imageId: 'another-story-image' },
      { env: environment, fetchImpl }
    ),
    /does not belong/
  );
});
