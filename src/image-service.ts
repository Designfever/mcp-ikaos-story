import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { StoryApiClient } from './story-api.js';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

type Fetch = typeof fetch;
type ViewportScope = 'mobile' | 'tablet' | 'desktop' | 'wide';

export type StoryImageViewport = {
  label?: string;
  width?: number;
  height?: number;
  scope?: ViewportScope;
};

type StoryImageTarget = {
  type: 'route';
  projectId: string;
  pageUrl: string;
  slot: string;
  viewport?: StoryImageViewport;
};

export type StoryImage = {
  id: string;
  target: StoryImageTarget;
  imageUrl: string;
  label?: string;
  order: number;
  [key: string]: unknown;
};

type ImageStoreConfig = {
  baseUrl: string;
  projectId: string;
  token: string;
};

type ImageStoreOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: Fetch;
};

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  message?: string;
  code?: string;
};

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Story image tools`);
  return value;
}

function readConfig(env: NodeJS.ProcessEnv = process.env): ImageStoreConfig {
  return {
    baseUrl: requiredEnv(env, 'DF_SHEET_URL').replace(/\/+$/, ''),
    projectId: requiredEnv(env, 'DF_SHEET_PROJECT_ID'),
    token: requiredEnv(env, 'DF_SHEET_ACCESS_TOKEN')
  };
}

function normalizeViewport(viewport?: StoryImageViewport): StoryImageViewport | undefined {
  if (!viewport) return undefined;
  const normalized = {
    ...(viewport.label?.trim() ? { label: viewport.label.trim() } : {}),
    ...(viewport.width ? { width: viewport.width } : {}),
    ...(viewport.height ? { height: viewport.height } : {}),
    ...(viewport.scope ? { scope: viewport.scope } : {})
  };
  return Object.keys(normalized).length ? normalized : undefined;
}

function imageSlots(data: unknown): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const packages = (data as Record<string, unknown>).imagePromptPackages;
  if (!Array.isArray(packages)) return [];
  return [...new Set(packages.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const inputBrief = (entry as Record<string, unknown>).inputBrief;
    if (!inputBrief || typeof inputBrief !== 'object' || Array.isArray(inputBrief)) return [];
    const slotId = (inputBrief as Record<string, unknown>).slotId;
    return typeof slotId === 'string' && slotId.trim() ? [slotId.trim()] : [];
  }))];
}

async function storyTarget(
  storyId: string,
  slotId: string,
  viewport: StoryImageViewport | undefined,
  projectId: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: Fetch
) {
  const context = await new StoryApiClient({ env, fetchImpl }).getStory(storyId);
  if (!context.route) throw new Error(`Story ${context.id} has no preview route`);
  if (!context.currentData) throw new Error(`No Story content exists for ${context.id}`);
  const slots = imageSlots(context.currentData.data);
  if (!slots.includes(slotId)) {
    throw new Error(`Unknown image slot ${slotId} for ${context.id}. Available slots: ${slots.join(', ') || '(none)'}`);
  }
  const normalizedViewport = normalizeViewport(viewport);
  return {
    storyId: context.id,
    target: {
      type: 'route' as const,
      projectId,
      pageUrl: context.route,
      slot: slotId,
      ...(normalizedViewport ? { viewport: normalizedViewport } : {})
    }
  };
}

function mimeTypeForFile(filePath: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      throw new Error('Image must be PNG, JPG, JPEG, or WebP');
  }
}

async function imageAsset(imagePath: string) {
  const absolutePath = path.resolve(imagePath);
  const info = await stat(absolutePath);
  if (!info.isFile()) throw new Error(`Image path is not a file: ${absolutePath}`);
  if (!info.size) throw new Error('Image file is empty');
  if (info.size > MAX_IMAGE_BYTES) throw new Error('Image file must be 20MB or smaller');
  const mimeType = mimeTypeForFile(absolutePath);
  const buffer = await readFile(absolutePath);
  return {
    path: absolutePath,
    asset: { mimeType, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` }
  };
}

class ImageStoreClient {
  private readonly config: ImageStoreConfig;
  private readonly fetchImpl: Fetch;

  constructor(options: ImageStoreOptions = {}) {
    this.config = readConfig(options.env);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.config.baseUrl}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers
      },
      signal: init?.signal ?? AbortSignal.timeout(60_000)
    });
    const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
    if (!response.ok || !body?.success || body.data === undefined) {
      const detail = body?.message || `${response.status} ${response.statusText}`;
      throw new Error(`df-sheet image API failed: ${detail}${body?.code ? ` (${body.code})` : ''}`);
    }
    return body.data;
  }

  list(target: StoryImageTarget) {
    const query = new URLSearchParams({ target: JSON.stringify(target) });
    return this.request<StoryImage[]>(`/api/review/figma-images?${query}`);
  }

  upload(target: StoryImageTarget, asset: { mimeType: string; dataUrl: string }, label?: string, order?: number) {
    return this.request<StoryImage>('/api/review/figma-images', {
      method: 'POST',
      body: JSON.stringify({ target, asset, ...(label?.trim() ? { label: label.trim() } : {}), ...(order === undefined ? {} : { order }) })
    });
  }

  update(imageId: string, patch: { label?: string | null; order?: number }) {
    return this.request<StoryImage>(`/api/review/figma-images/${encodeURIComponent(imageId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
  }

  remove(imageId: string) {
    return this.request<{ id: string }>(`/api/review/figma-images/${encodeURIComponent(imageId)}`, { method: 'DELETE' });
  }
}

async function scopedImage(options: {
  storyId: string;
  slotId: string;
  imageId: string;
  viewport?: StoryImageViewport;
  client: ImageStoreClient;
  projectId: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: Fetch;
}) {
  const { storyId, target } = await storyTarget(
    options.storyId,
    options.slotId,
    options.viewport,
    options.projectId,
    options.env,
    options.fetchImpl
  );
  const images = await options.client.list(target);
  const image = images.find((candidate) => candidate.id === options.imageId);
  if (!image) throw new Error(`Image ${options.imageId} does not belong to ${storyId}/${options.slotId}`);
  return { storyId, target, image };
}

export async function listStoryImages(input: { storyId: string; slotId: string; viewport?: StoryImageViewport }, options: ImageStoreOptions = {}) {
  const config = readConfig(options.env);
  const client = new ImageStoreClient(options);
  const { storyId, target } = await storyTarget(input.storyId, input.slotId, input.viewport, config.projectId, options.env, options.fetchImpl);
  return { storyId, slotId: input.slotId, target, images: await client.list(target) };
}

export async function uploadStoryImage(input: {
  storyId: string;
  slotId: string;
  imagePath: string;
  viewport?: StoryImageViewport;
  label?: string;
  order?: number;
}, options: ImageStoreOptions = {}) {
  const config = readConfig(options.env);
  const client = new ImageStoreClient(options);
  const [{ storyId, target }, local] = await Promise.all([
    storyTarget(input.storyId, input.slotId, input.viewport, config.projectId, options.env, options.fetchImpl),
    imageAsset(input.imagePath)
  ]);
  const image = await client.upload(target, local.asset, input.label, input.order);
  return { storyId, slotId: input.slotId, sourcePath: local.path, image };
}

export async function updateStoryImage(input: {
  storyId: string;
  slotId: string;
  imageId: string;
  viewport?: StoryImageViewport;
  imagePath?: string;
  label?: string | null;
  order?: number;
}, options: ImageStoreOptions = {}) {
  if (input.imagePath === undefined && input.label === undefined && input.order === undefined) {
    throw new Error('Provide image_path, label, or order to update an image');
  }
  const config = readConfig(options.env);
  const client = new ImageStoreClient(options);
  const scoped = await scopedImage({ ...input, client, projectId: config.projectId, env: options.env, fetchImpl: options.fetchImpl });

  if (!input.imagePath) {
    const image = await client.update(input.imageId, {
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.order === undefined ? {} : { order: input.order })
    });
    return { storyId: scoped.storyId, slotId: input.slotId, replaced: false, image };
  }

  const local = await imageAsset(input.imagePath);
  const replacement = await client.upload(
    scoped.target,
    local.asset,
    input.label === undefined ? scoped.image.label : input.label ?? undefined,
    input.order ?? scoped.image.order
  );
  try {
    await client.remove(scoped.image.id);
  } catch (error) {
    return {
      storyId: scoped.storyId,
      slotId: input.slotId,
      replaced: false,
      replacement,
      original: scoped.image,
      warning: `Replacement uploaded, but original deletion failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  return { storyId: scoped.storyId, slotId: input.slotId, replaced: true, previousImageId: scoped.image.id, image: replacement };
}

export async function deleteStoryImage(input: {
  storyId: string;
  slotId: string;
  imageId: string;
  viewport?: StoryImageViewport;
}, options: ImageStoreOptions = {}) {
  const config = readConfig(options.env);
  const client = new ImageStoreClient(options);
  const scoped = await scopedImage({ ...input, client, projectId: config.projectId, env: options.env, fetchImpl: options.fetchImpl });
  const deleted = await client.remove(input.imageId);
  return { storyId: scoped.storyId, slotId: input.slotId, deleted, recoverable: false };
}
