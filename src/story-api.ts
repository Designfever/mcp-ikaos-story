import type { JsonObject } from './types.js';

export const STORY_RULES = {
  pipeline: 'pipeline',
  core: 'core',
  workflow: 'workflow',
  semantic: 'semantic',
  quote: 'quote',
  catalog: 'catalog',
  basic: 'basic',
  immersive: 'immersive',
  narrative: 'narrative'
} as const;

export type StoryRuleName = keyof typeof STORY_RULES;
export type StoryProductionType = 'basic' | 'immersive' | 'narrative';

export type StorySummary = {
  id: string;
  title: string;
  status: 'ready' | 'waiting';
  type: string | null;
  templateId: string | null;
  productionStatus: string;
  productionStage: string;
  route: string | null;
  division: string;
  sheetRow: number;
  chapter: string;
  section: string;
  hasContent: boolean;
  revision: string | null;
  docsLink: string | null;
};

export type StoryApiContext = StorySummary & {
  story: Record<string, unknown>;
  identity: {
    chapter: string;
    chapterTitle: string;
    section: string;
    story: string;
  };
  authoritativeDocument: {
    fileName: string | null;
    url: string | null;
    sha256: string | null;
    sheetRow: number | null;
  };
  currentData: { revision: string | null; updatedAt: string | null; data: JsonObject } | null;
  protectedFields: string[];
};

export type StoryApiOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  message?: string;
  currentRevision?: string | null;
};

function requiredEnvironment(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export class StoryApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: StoryApiOptions = {}) {
    const env = options.env ?? process.env;
    this.baseUrl = requiredEnvironment(env, 'IKAOS_STORY_API_URL').replace(/\/+$/, '');
    this.token = requiredEnvironment(env, 'IKAOS_STORY_API_TOKEN');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers
      },
      signal: init?.signal ?? AbortSignal.timeout(60_000)
    });
    const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
    if (!response.ok || !body?.success || body.data === undefined) {
      const message = body?.message || `${response.status} ${response.statusText}`;
      const suffix = body?.currentRevision !== undefined && !message.includes('Current revision:')
        ? ` Current revision: ${body.currentRevision ?? 'none'}`
        : '';
      throw new Error(`${message}${suffix}`);
    }
    return body.data;
  }

  listStories() {
    return this.request<StorySummary[]>('/api/mcp/stories');
  }

  getStory(storyId: string) {
    return this.request<StoryApiContext>(`/api/mcp/stories/${encodeURIComponent(storyId)}`);
  }

  getRule(rule: StoryRuleName) {
    return this.request<{ rule: StoryRuleName; path: string; content: string }>(
      `/api/mcp/rules/${encodeURIComponent(rule)}`
    );
  }

  startStory(storyId: string, storyType: StoryProductionType) {
    return this.request<StoryApiContext>(
      `/api/mcp/stories/${encodeURIComponent(storyId)}/start`,
      {
        method: 'POST',
        body: JSON.stringify({ type: storyType })
      }
    );
  }

  updateStory(storyId: string, content: JsonObject, expectedRevision: string | null) {
    return this.request<StoryApiContext>(`/api/mcp/stories/${encodeURIComponent(storyId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ content, expectedRevision })
    });
  }
}
