# mcp-ikaos-story

Stdio MCP server for creating and modifying iKAOS Story prototype content with Codex or Claude Code.

The MCP talks to the authenticated iKAOS Story API. Users do not need to clone `ikaos-content-studio-v2026` or configure a local repository path. Story content/layout JSON lives in Supabase, while fixed workflow documents and source metadata remain read-only behind the API.

## Boundaries

- `get_story_context` returns the current content revision and authoritative `docsLink`.
- `save_story_content` writes only `content_data`; source, docs, Story identity, and production metadata cannot be changed.
- Every content write requires the exact current revision. A stale edit returns a conflict instead of overwriting newer content.
- Image generation is out of scope. Designers can upload, replace, organize, and delete supplied image files through df-sheet storage.
- No Supabase service key is distributed to MCP users.

## Install

```bash
npm install
npm run build
```

Configure the Story API:

```bash
export IKAOS_STORY_API_URL=https://your-ikaos-preview.vercel.app
export IKAOS_STORY_API_TOKEN=your-project-scoped-api-token
export IKAOS_STORY_PREVIEW_URL=https://your-ikaos-preview.vercel.app
```

Image tools additionally require:

```bash
export DF_SHEET_URL=https://your-df-sheet.vercel.app
export DF_SHEET_PROJECT_ID=your-project-uuid
export DF_SHEET_ACCESS_TOKEN=your-df-login-review-access-token
```

`IKAOS_STORY_PREVIEW_URL` is optional and defaults to `http://localhost:3000`. `DF_SHEET_ACCESS_TOKEN` is currently a short-lived df-login review access token. Never commit any token.

## Codex

```bash
codex mcp add ikaos-story \
  --env IKAOS_STORY_API_URL=https://your-ikaos-preview.vercel.app \
  --env IKAOS_STORY_API_TOKEN=your-project-scoped-api-token \
  --env IKAOS_STORY_PREVIEW_URL=https://your-ikaos-preview.vercel.app \
  -- node /absolute/path/to/mcp-ikaos-story/dist/src/index.js
```

Add the three `DF_SHEET_*` env values to the same command when image tools are needed. Verify with `codex mcp list` or `/mcp`.

## Claude Code

```bash
claude mcp add --transport stdio \
  --env IKAOS_STORY_API_URL=https://your-ikaos-preview.vercel.app \
  --env IKAOS_STORY_API_TOKEN=your-project-scoped-api-token \
  --env IKAOS_STORY_PREVIEW_URL=https://your-ikaos-preview.vercel.app \
  ikaos-story -- node /absolute/path/to/mcp-ikaos-story/dist/src/index.js
```

Add the three `DF_SHEET_*` env values when image tools are needed. Verify with `claude mcp list` or `/mcp`.

## Tools

| Tool | Effect |
| --- | --- |
| `list_stories` | List Supabase-backed Story status, content revision, preview route, and docs link. |
| `get_story_context` | Read identity, authoritative document link, current content JSON, and revision. |
| `get_story_rules` | Read fixed workflow, semantic, Quote, catalog, or producer rules through the API. |
| `save_story_content` | Create or modify content/layout JSON with optimistic revision protection. |
| `validate_story` | Validate the current Story identity and required content arrays. |
| `list_story_images` | List stored images for a Story slot and optional viewport. |
| `upload_story_image` | Upload a local PNG/JPG/WebP file, up to 20MB. |
| `update_story_image` | Change label/order, or safely replace the file. |
| `delete_story_image` | Permanently delete a Story image after scope verification. |

## Content workflow

1. Call `get_story_context`.
2. Open `docsLink` and read the required fixed rules with `get_story_rules`.
3. Modify only the returned `currentData.data` content/layout object.
4. Call `save_story_content` with the unchanged Story ID and `currentData.revision`. Use `null` only when the Story has no content yet.
5. Call `validate_story`, then check the returned preview URL at 390px and 1280px.

If another client saved first, fetch the latest context and merge intentionally. Do not retry with a replaced revision without reviewing the newer content.

## Image workflow

1. Choose a valid `imagePromptPackages[].inputBrief.slotId` from the Story content.
2. Call `upload_story_image` with an absolute local image path.
3. Use the returned `imageUrl` in the Story content and save it with `save_story_content`.
4. Call `update_story_image` to change metadata or replace the file. Replacement uploads first and deletes the old file only after upload succeeds.
5. Call `delete_story_image` only after confirming the image ID. Deletion removes the R2 object and cannot be recovered by this MCP.

Omit `viewport` for one responsive source. Pass the exact same viewport object to list, update, and delete when using separate mobile or desktop files.
