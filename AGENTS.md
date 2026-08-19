# AGENTS.md

## Scope

- Keep this MCP a small adapter around the authenticated iKAOS Story API.
- Do not copy mutable Story business rules into this repository.
- Do not add image generation tools.
- Designer-supplied image files may be uploaded only through the configured DF Asset Hub API.
- Do not add image generation, storage listing, or file deletion claims that Asset Hub cannot support.

## Safety

- Story documentation, source metadata, category identity, and production metadata are read-only.
- Story content writes must use the API revision returned by `get_story_context`.
- Image upload and update operations must verify the Story route and slot before calling Asset Hub.
- Image updates must keep the scoped image ID created by `upload_story_image`.
- Never accept an arbitrary command from MCP input.
- Preserve the optimistic revision check.

## Verification

Run `npm run check` after changes.
