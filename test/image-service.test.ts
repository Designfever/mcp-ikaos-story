import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { updateStoryImage, uploadStoryImage } from '../src/image-service.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

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
  DF_ASSET_UPLOAD_URL: 'https://assets.test/api/review/figma-images/upload',
  DF_ASSET_PROJECT_ID: 'ikaos-test'
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

function storySuccess() {
  return new Response(JSON.stringify({ success: true, data: storyContext() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function assetSuccess(imageId: string) {
  const storageKey = `ikaos-test/figma-images/${imageId}.png`;
  return new Response(JSON.stringify({
    r2Key: storageKey,
    storageKey,
    publicUrl: `https://assets.test/${storageKey}`,
    imageUrl: `https://assets.test/${storageKey}`,
    imageId,
    contentType: 'image/png',
    imageFormat: 'png',
    byteSize: PNG.byteLength
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('uploads a scoped local image directly to Asset Hub', async (t) => {
  const local = await fixture();
  t.after(() => rm(local.root, { recursive: true, force: true }));
  let assetRequest: { url: string; init?: RequestInit } | undefined;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('https://story.test')) return storySuccess();
    assetRequest = { url: String(input), init };
    return assetSuccess(new URL(String(input)).searchParams.get('imageId') || '');
  };
  const result = await uploadStoryImage(
    { storyId: 'p-1-A', slotId: 'basic-image-01', imagePath: local.imagePath },
    { env: environment, fetchImpl }
  );
  const url = new URL(assetRequest?.url || '');
  assert.equal(result.storyId, 'P-1-a');
  assert.equal(url.searchParams.get('projectId'), 'ikaos-test');
  assert.match(result.image.imageId, /^p-1-a--basic-image-01--shared--[0-9a-f-]{36}$/);
  assert.equal((assetRequest?.init?.headers as Record<string, string>)['Content-Type'], 'image/png');
  assert.deepEqual(Buffer.from(assetRequest?.init?.body as Uint8Array), PNG);
});

test('replaces an owned image by uploading to the same image ID', async (t) => {
  const local = await fixture();
  t.after(() => rm(local.root, { recursive: true, force: true }));
  const imageId = 'p-1-a--basic-image-01--shared--123e4567-e89b-12d3-a456-426614174000';
  let uploadedId = '';
  const fetchImpl = async (input: string | URL | Request) => {
    if (String(input).startsWith('https://story.test')) return storySuccess();
    uploadedId = new URL(String(input)).searchParams.get('imageId') || '';
    return assetSuccess(uploadedId);
  };
  const result = await updateStoryImage(
    { storyId: 'P-1-a', slotId: 'basic-image-01', imageId, imagePath: local.imagePath },
    { env: environment, fetchImpl }
  );
  assert.equal(uploadedId, imageId);
  assert.equal(result.replaced, true);
  assert.equal(result.image.imageId, imageId);
});

test('refuses to replace an image outside the requested Story slot', async (t) => {
  const local = await fixture();
  t.after(() => rm(local.root, { recursive: true, force: true }));
  const fetchImpl = async (input: string | URL | Request) =>
    String(input).startsWith('https://story.test')
      ? storySuccess()
      : assetSuccess('another-story--basic-image-01--shared--id');
  await assert.rejects(
    () => updateStoryImage(
      {
        storyId: 'P-1-a',
        slotId: 'basic-image-01',
        imageId: 'another-story--basic-image-01--shared--id',
        imagePath: local.imagePath
      },
      { env: environment, fetchImpl }
    ),
    /does not belong/
  );
});

test('refuses an unknown Story image slot before upload', async (t) => {
  const local = await fixture();
  t.after(() => rm(local.root, { recursive: true, force: true }));
  const fetchImpl = async () => storySuccess();
  await assert.rejects(
    () => uploadStoryImage(
      { storyId: 'P-1-a', slotId: 'missing-slot', imagePath: local.imagePath },
      { env: environment, fetchImpl }
    ),
    /Unknown image slot/
  );
});
