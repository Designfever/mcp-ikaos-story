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

test('starts Story production through the authenticated API', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    request = { url: String(input), init };
    return json({ success: true, data: { id: '6-5-a', productionStatus: 'in_progress' } });
  };
  await new StoryApiClient({ env, fetchImpl }).startStory('6-5-a', 'immersive', 'I-05');
  assert.equal(request?.url, 'https://story.test/api/mcp/stories/6-5-a/start');
  assert.equal(request?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    type: 'immersive',
    template_id: 'I-05'
  });
});

test('previews and confirms a typed Story status-only update', async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return json({
      success: true,
      data: { status: 'awaiting_review', selection: 'typed', storyIds: ['P-1-a'], total: 1 }
    });
  };
  const client = new StoryApiClient({ env, fetchImpl });
  await client.previewTypedStoryStatusUpdate();
  await client.confirmTypedStoryStatusUpdate(['P-1-a']);
  assert.deepEqual(bodies[0], {
    mode: 'preview',
    status: 'awaiting_review',
    selection: 'typed'
  });
  assert.deepEqual(bodies[1], {
    mode: 'confirm',
    status: 'awaiting_review',
    selection: 'typed',
    expectedStoryIds: ['P-1-a']
  });
});

test('previews and confirms Story reset through the authenticated API', async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(input), body });
    return body.mode === 'preview'
      ? json({ success: true, data: { storyId: '6-6-a', previewToken: 'signed-token' } })
      : json({
          success: true,
          data: { story: { id: '6-6-a', productionStatus: 'not_started' }, archiveId: 'archive-1' }
        });
  };
  const client = new StoryApiClient({ env, fetchImpl });
  await client.resetStoryPreview('6-6-a');
  await client.resetStoryConfirm('6-6-a', 'signed-token', 'RESET 6-6-a');

  assert.equal(requests[0]?.url, 'https://story.test/api/mcp/stories/6-6-a/reset');
  assert.deepEqual(requests[0]?.body, { mode: 'preview' });
  assert.deepEqual(requests[1]?.body, {
    mode: 'confirm',
    previewToken: 'signed-token',
    confirmation: 'RESET 6-6-a'
  });
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
