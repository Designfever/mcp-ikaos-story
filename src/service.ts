import {
  StoryApiClient,
  type StoryProductionType,
  type StoryRuleName
} from './story-api.js';
import type { JsonObject } from './types.js';

function previewUrl(route: string | null): string | null {
  if (!route) return null;
  const origin = (process.env.IKAOS_STORY_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${origin}${route.startsWith('/') ? route : `/${route}`}`;
}

export function validateContent(storyId: string, content: JsonObject) {
  const errors: string[] = [];
  const receipt = content.receipt;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    errors.push('content.receipt is required');
  } else if (String((receipt as JsonObject).storyId).toLowerCase() !== storyId.toLowerCase()) {
    errors.push('content.receipt.storyId must match the Story ID');
  }
  if (!Array.isArray(content.articleBlocks)) errors.push('content.articleBlocks must be an array');
  if (!Array.isArray(content.imageSlots)) {
    errors.push('content.imageSlots must be an array');
  }
  return errors;
}

export async function listStorySummaries(status?: 'ready' | 'waiting') {
  const stories = await new StoryApiClient().listStories();
  return stories
    .filter((story) => !status || story.status === status)
    .map((story) => ({ ...story, previewUrl: previewUrl(story.route) }));
}

export async function getStoryContext(storyId: string) {
  const context = await new StoryApiClient().getStory(storyId);
  return {
    ...context,
    previewUrl: previewUrl(context.route),
    docsLink: context.authoritativeDocument.url,
    requiredRules: ['pipeline', 'core', 'workflow', 'semantic', 'quote'],
    imagePolicy: 'MCP does not generate images. Designers may manage supplied files with the Story image tools.'
  };
}

export async function getStoryRule(name: StoryRuleName) {
  return new StoryApiClient().getRule(name);
}

export async function startStoryProduction(
  storyId: string,
  storyType: StoryProductionType,
  templateId: string
) {
  const context = await new StoryApiClient().startStory(storyId, storyType, templateId);
  return {
    storyId: context.id,
    type: context.type,
    templateId: context.templateId,
    productionStatus: context.productionStatus,
    productionStage: context.productionStage,
    route: context.route,
    sourceDocumentSha256: context.authoritativeDocument.sha256,
    previewUrl: previewUrl(context.route),
    docsLink: context.authoritativeDocument.url
  };
}

export async function saveStoryContent(input: {
  storyId: string;
  content: JsonObject;
  expectedRevision: string | null;
}) {
  const errors = validateContent(input.storyId, input.content);
  if (errors.length) throw new Error(errors.join('; '));
  const context = await new StoryApiClient().updateStory(
    input.storyId,
    input.content,
    input.expectedRevision
  );
  return {
    storyId: context.id,
    revision: context.currentData?.revision ?? null,
    updatedAt: context.currentData?.updatedAt ?? null,
    previewUrl: previewUrl(context.route),
    docsLink: context.authoritativeDocument.url
  };
}

export async function validateStory(storyId: string) {
  const context = await new StoryApiClient().getStory(storyId);
  if (!context.currentData) throw new Error(`No Story content exists for ${context.id}`);
  const errors = validateContent(context.id, context.currentData.data);
  return {
    ok: errors.length === 0,
    storyId: context.id,
    revision: context.currentData.revision,
    previewUrl: previewUrl(context.route),
    docsLink: context.authoritativeDocument.url,
    errors
  };
}
