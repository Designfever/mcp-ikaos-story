import assert from 'node:assert/strict';
import test from 'node:test';
import { StoryApiClient } from '../src/story-api.js';

const env = {
  IKAOS_STORY_API_URL: 'https://story.test/',
  IKAOS_STORY_API_TOKEN: 'story-secret'
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('lists Stories through the authenticated Story API', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    request = { url: String(input), init };
    return json({ success: true, data: [{ id: 'P-1-a' }] });
  };
  const stories = await new StoryApiClient({ env, fetchImpl }).listStories();
  assert.equal(stories[0]?.id, 'P-1-a');
  assert.equal(request?.url, 'https://story.test/api/mcp/stories');
  assert.equal(
    request?.init?.headers && (request.init.headers as Record<string, string>).Authorization,
    'Bearer story-secret'
  );
});

test('sends optimistic revision when saving Story content', async () => {
  let body: Record<string, unknown> = {};
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return json({ success: true, data: { id: 'P-1-a' } });
  };
  await new StoryApiClient({ env, fetchImpl }).updateStory(
    'P-1-a',
    { receipt: { storyId: 'P-1-a' }, articleBlocks: [], imageSlots: [] },
    'a'.repeat(64)
  );
  assert.equal(body.expectedRevision, 'a'.repeat(64));
  assert.equal((body.content as Record<string, unknown>).receipt instanceof Object, true);
});

test('surfaces the current revision on a write conflict', async () => {
  const revision = 'b'.repeat(64);
  const fetchImpl = async () => json({
    success: false,
    message: 'Story content changed',
    currentRevision: revision
  }, 409);
  await assert.rejects(
    () => new StoryApiClient({ env, fetchImpl }).updateStory('P-1-a', {}, 'a'.repeat(64)),
    new RegExp(`Current revision: ${revision}`)
  );
});

test('does not duplicate revision already present in the API message', async () => {
  const revision = 'b'.repeat(64);
  const fetchImpl = async () => json({
    success: false,
    message: `Story content changed. Current revision: ${revision}`,
    currentRevision: revision
  }, 409);
  await assert.rejects(
    () => new StoryApiClient({ env, fetchImpl }).updateStory('P-1-a', {}, 'a'.repeat(64)),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, `Story content changed. Current revision: ${revision}`);
      return true;
    }
  );
});
