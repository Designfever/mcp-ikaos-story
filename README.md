# mcp-ikaos-story

Stdio MCP server for creating and modifying iKAOS Story prototype content with Codex or Claude Code.

The MCP talks to the authenticated iKAOS Story API. Users do not need to clone `ikaos-content-studio-v2026` or configure a local repository path. Story content/layout JSON lives in Supabase, while fixed workflow documents and source metadata remain read-only behind the API.

## Boundaries

- `get_story_context` returns the current content revision and authoritative `docsLink`.
- `save_story_content` writes only `content_data`; source, docs, Story identity, and production metadata cannot be changed.
- Every content write requires the exact current revision. A stale edit returns a conflict instead of overwriting newer content.
- Image generation is out of scope. Designers can upload and replace supplied image files through DF Asset Hub.
- Asset Hub does not currently expose list or delete APIs. Removing an image URL from Story content does not remove its R2 object.
- No Supabase service key is distributed to MCP users.

## Install

```bash
npm install
npm run build
```

Configure the Story API:

```bash
export IKAOS_STORY_API_URL=https://ikaos-content-studio-v2026.vercel.app
export IKAOS_STORY_API_TOKEN=your-project-scoped-api-token
```

Image uploads use these defaults, so users do not need a df-login token:

```bash
export DF_ASSET_UPLOAD_URL=https://df-asset-hub.vercel.app/api/review/figma-images/upload
export DF_ASSET_PROJECT_ID=ikaos-story-2026
```

Both `DF_ASSET_*` values are optional overrides. Preview links use `IKAOS_STORY_API_URL` as their origin. Never commit the Story API token.

## Codex

```bash
codex mcp add ikaos-story \
  --env IKAOS_STORY_API_URL=https://ikaos-content-studio-v2026.vercel.app \
  --env IKAOS_STORY_API_TOKEN=your-project-scoped-api-token \
  -- node /absolute/path/to/mcp-ikaos-story/dist/src/index.js
```

The default Asset Hub endpoint and project namespace need no extra Codex env values. Verify with `codex mcp list` or `/mcp`.

## Claude Code

```bash
claude mcp add --transport stdio \
  --env IKAOS_STORY_API_URL=https://ikaos-content-studio-v2026.vercel.app \
  --env IKAOS_STORY_API_TOKEN=your-project-scoped-api-token \
  ikaos-story -- node /absolute/path/to/mcp-ikaos-story/dist/src/index.js
```

The default Asset Hub endpoint and project namespace need no extra Claude env values. Verify with `claude mcp list` or `/mcp`.

## Tools

| Tool | Effect |
| --- | --- |
| `list_stories` | List Supabase-backed Story status, content revision, preview route, and docs link. |
| `get_story_context` | Read identity, authoritative document link, current content JSON, and revision. |
| `get_story_rules` | Read fixed workflow, semantic, Quote, catalog, or producer rules through the API. |
| `save_story_content` | Create or modify content/layout JSON with optimistic revision protection. |
| `validate_story` | Validate the current Story identity and required content arrays. |
| `upload_story_image` | Upload a local PNG/JPG/WebP file, up to 20MB. |
| `update_story_image` | Replace the file using the scoped image ID returned by upload. |

## Content workflow

1. Call `get_story_context`.
2. Open `docsLink` and read the required fixed rules with `get_story_rules`.
3. Modify only the returned `currentData.data` content/layout object. Read-only fields may be omitted, but any supplied values must remain unchanged.
4. Call `save_story_content` with the unchanged Story ID and `currentData.revision`. Use `null` only when the Story has no content yet.
5. Call `validate_story`, then check the returned preview URL at 390px and 1280px.

If another client saved first, fetch the latest context and merge intentionally. Do not retry with a replaced revision without reviewing the newer content.

## Image workflow

1. Choose a valid `imageSlots[].slotId` from the Story content.
2. Call `upload_story_image` with an absolute local image path.
3. Use the returned `imageUrl` in the Story content and save it with `save_story_content`.
4. Call `update_story_image` with the returned `imageId` to replace that Asset Hub image. Keep the same file format to reuse the exact R2 key.
5. To stop using an image, remove its URL from Story content and save the new revision. The R2 object remains until Asset Hub adds a delete API.

Omit `viewport` for one responsive source. Pass the exact same viewport object to update when using separate mobile or desktop files.
