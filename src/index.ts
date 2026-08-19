#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { STORY_RULES } from './story-api.js';
import {
  deleteStoryImage,
  listStoryImages,
  updateStoryImage,
  uploadStoryImage
} from './image-service.js';
import {
  getStoryContext,
  getStoryRule,
  listStorySummaries,
  saveStoryContent,
  validateStory
} from './service.js';

function output(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function buildServer() {
  const server = new McpServer({ name: 'mcp-ikaos-story', version: '0.1.0' });

  server.registerTool(
    'list_story_images',
    {
      description: 'List designer images stored for one Story image slot.',
      inputSchema: z.object({
        story_id: z.string().min(1),
        slot_id: z.string().min(1),
        viewport: viewportSchema.optional()
      })
    },
    async ({ story_id, slot_id, viewport }) => {
      try {
        return output(await listStoryImages({ storyId: story_id, slotId: slot_id, viewport }));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'upload_story_image',
    {
      description: 'Upload a local PNG, JPG, JPEG, or WebP file to one Story image slot. df-sheet stores it as WebP.',
      inputSchema: z.object({
        story_id: z.string().min(1),
        slot_id: z.string().min(1),
        image_path: z.string().min(1),
        viewport: viewportSchema.optional(),
        label: z.string().optional(),
        order: z.number().finite().optional()
      })
    },
    async ({ story_id, slot_id, image_path, viewport, label, order }) => {
      try {
        return output(await uploadStoryImage({ storyId: story_id, slotId: slot_id, imagePath: image_path, viewport, label, order }));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'update_story_image',
    {
      description: 'Update image label/order or safely replace its file after verifying Story and slot ownership.',
      inputSchema: z.object({
        story_id: z.string().min(1),
        slot_id: z.string().min(1),
        image_id: z.string().min(1),
        viewport: viewportSchema.optional(),
        image_path: z.string().min(1).optional(),
        label: z.string().nullable().optional(),
        order: z.number().finite().optional()
      })
    },
    async ({ story_id, slot_id, image_id, viewport, image_path, label, order }) => {
      try {
        return output(await updateStoryImage({ storyId: story_id, slotId: slot_id, imageId: image_id, viewport, imagePath: image_path, label, order }));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'delete_story_image',
    {
      description: 'Permanently delete one image after verifying Story and slot ownership.',
      inputSchema: z.object({
        story_id: z.string().min(1),
        slot_id: z.string().min(1),
        image_id: z.string().min(1),
        viewport: viewportSchema.optional()
      })
    },
    async ({ story_id, slot_id, image_id, viewport }) => {
      try {
        return output(await deleteStoryImage({ storyId: story_id, slotId: slot_id, imageId: image_id, viewport }));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'list_stories',
    {
      description: 'List iKAOS Story IDs and their read-only delivery status.',
      inputSchema: z.object({ status: z.enum(['ready', 'waiting']).optional() })
    },
    async ({ status }) => {
      try {
        return output({ stories: await listStorySummaries(status) });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'get_story_context',
    {
      description: 'Read one Story identity, authoritative document receipt, current data, revision, and preview URL.',
      inputSchema: z.object({ story_id: z.string().min(1) })
    },
    async ({ story_id }) => {
      try {
        return output(await getStoryContext(story_id));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'get_story_rules',
    {
      description: 'Read one immutable Story workflow, semantic, Quote, catalog, or producer rule file.',
      inputSchema: z.object({ rule: z.enum(Object.keys(STORY_RULES) as [keyof typeof STORY_RULES, ...(keyof typeof STORY_RULES)[]]) })
    },
    async ({ rule }) => {
      try {
        return output(await getStoryRule(rule));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'save_story_content',
    {
      description: 'Create or modify Story content/layout JSON with optimistic revision protection. Fixed docs and source metadata cannot be changed.',
      inputSchema: z.object({
        story_id: z.string().min(1),
        content: z.record(z.string(), z.unknown()),
        expected_revision: z.string().length(64).nullable()
      })
    },
    async ({ story_id, content, expected_revision }) => {
      try {
        return output(await saveStoryContent({ storyId: story_id, content, expectedRevision: expected_revision }));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'validate_story',
    {
      description: 'Validate the current Supabase Story content structure and identity.',
      inputSchema: z.object({
        story_id: z.string().min(1),
        mode: z.literal('static').default('static')
      })
    },
    async ({ story_id }) => {
      try {
        return output(await validateStory(story_id));
      } catch (error) {
        return failure(error);
      }
    }
  );

  return server;
}

const viewportSchema = z.object({
  label: z.string().min(1).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  scope: z.enum(['mobile', 'tablet', 'desktop', 'wide']).optional()
});

serveStdio(buildServer);
