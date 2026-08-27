import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/src/index.js'],
  cwd: process.cwd(),
  env: Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  )
});
const client = new Client({ name: 'mcp-ikaos-story-smoke', version: '0.1.0' });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  const expected = [
    'get_story_context',
    'get_story_rules',
    'list_stories',
    'reset_story',
    'save_story_content',
    'start_story',
    'update_story_image',
    'upload_story_image',
    'validate_story'
  ];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected MCP tools: ${JSON.stringify(names)}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, tools: names, localStoryRepositoryRequired: false })}\n`);
} finally {
  await client.close();
}
