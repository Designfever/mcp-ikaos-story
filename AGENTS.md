# AGENTS.md

## Scope

- Keep this MCP a small adapter around the authenticated iKAOS Story API.
- Do not copy mutable Story business rules into this repository.
- Do not add image generation tools.
- Designer-supplied image files may be managed only through the configured df-sheet image API.
- Do not commit network or database credentials. Read image API credentials from the MCP process environment.

## Safety

- Story documentation, source metadata, category identity, and production metadata are read-only.
- Story content writes must use the API revision returned by `get_story_context`.
- Image update and delete operations must verify the Story route and slot before calling df-sheet.
- Never accept an arbitrary command from MCP input.
- Preserve the optimistic revision check.

## Verification

Run `npm run check` after changes.
