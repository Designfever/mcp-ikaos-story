#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { STORY_RULES } from './story-api.js';
import { updateStoryImage, uploadStoryImage } from './image-service.js';
import {
  confirmStoryReset,
  confirmTypedStoryStatusUpdate,
  getStoryContext,
  getStoryRule,
  listStorySummaries,
  previewStoryReset,
  previewTypedStoryStatusUpdate,
  saveStoryContent,
  startStoryProduction,
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
    'upload_story_image',
    {
      description: 'Upload a local PNG, JPG, JPEG, or WebP file to Asset Hub after verifying the Story image slot.',
      inputSchema: z.object({
        story_id: z.string().min(1),
        slot_id: z.string().min(1),
        image_path: z.string().min(1),
        viewport: viewportSchema.optional()
      })
    },
    async ({ story_id, slot_id, image_path, viewport }) => {
      try {
        return output(await uploadStoryImage({ storyId: story_id, slotId: slot_id, imagePath: image_path, viewport }));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'update_story_image',
    {
      description: 'Replace an Asset Hub image file using the scoped image ID returned by upload_story_image.',
      inputSchema: z.object({
        story_id: z.string().min(1),
        slot_id: z.string().min(1),
        image_id: z.string().min(1),
        viewport: viewportSchema.optional(),
        image_path: z.string().min(1)
      })
    },
    async ({ story_id, slot_id, image_id, viewport, image_path }) => {
      try {
        return output(await updateStoryImage({ storyId: story_id, slotId: slot_id, imageId: image_id, viewport, imagePath: image_path }));
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
    'start_story',
    {
      description: 'Start or refresh Story production after the user confirms its type and compatible template. The API locks the authoritative DOCX checksum and refuses completed Stories.',
      inputSchema: z.object({
        story_id: z.string().min(1),
        type: z.enum(['basic', 'immersive', 'narrative']),
        template_id: z.string().min(1)
      })
    },
    async ({ story_id, type, template_id }) => {
      try {
        return output(await startStoryProduction(story_id, type, template_id));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'bulk_update_story_status',
    {
      description: 'Preview or confirm a status-only update that moves every typed Story to awaiting_review. Content, images, type, template, source receipt, and revision are never included in the write.',
      inputSchema: z.object({
        mode: z.enum(['preview', 'confirm']),
        status: z.literal('awaiting_review'),
        selection: z.literal('typed'),
        expected_story_ids: z.array(z.string().min(1)).optional()
      })
    },
    async ({ mode, expected_story_ids }) => {
      try {
        if (mode === 'preview') return output(await previewTypedStoryStatusUpdate());
        if (!expected_story_ids) {
          throw new Error('expected_story_ids from preview are required for confirm');
        }
        return output(await confirmTypedStoryStatusUpdate(expected_story_ids));
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'reset_story',
    {
      description: 'Preview or confirm an atomic Story production reset. Preview first. Confirm archives the full production row, preserves Sheet/DOCX identity, and clears generated type, template, content, images, route, and revision. Sheet-classified, completed, or deployed Stories also require the exact confirmation string returned by preview.',
      inputSchema: z.object({
        story_id: z.string().min(1),
        mode: z.enum(['preview', 'confirm']),
        preview_token: z.string().min(1).optional(),
        confirmation: z.string().min(1).optional()
      })
    },
    async ({ story_id, mode, preview_token, confirmation }) => {
      try {
        if (mode === 'preview') return output(await previewStoryReset(story_id));
        if (!preview_token) throw new Error('preview_token is required for confirm');
        return output(
          await confirmStoryReset({
            storyId: story_id,
            previewToken: preview_token,
            confirmation
          })
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'save_story_content',
    {
      description: 'Create or modify Story content/layout JSON with optimistic revision protection. Omitted read-only fields are preserved by the API; supplied read-only values cannot be changed.',
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
