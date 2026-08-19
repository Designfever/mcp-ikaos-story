import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { StoryApiClient } from './story-api.js';

const DEFAULT_UPLOAD_URL = 'https://df-asset-hub.vercel.app/api/review/figma-images/upload';
const DEFAULT_PROJECT_ID = 'ikaos-story-2026';
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

type AssetHubImage = {
  r2Key: string;
  storageKey: string;
  publicUrl: string;
  imageUrl: string;
  imageId: string;
  contentType: string;
  imageFormat: string;
  byteSize: number;
};

type ImageStoreOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: Fetch;
};

function readConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    uploadUrl: (env.DF_ASSET_UPLOAD_URL || DEFAULT_UPLOAD_URL).trim(),
    projectId: (env.DF_ASSET_PROJECT_ID || DEFAULT_PROJECT_ID).trim()
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
    throw new Error(
      `Unknown image slot ${slotId} for ${context.id}. Available slots: ${slots.join(', ') || '(none)'}`
    );
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
  return {
    path: absolutePath,
    mimeType: mimeTypeForFile(absolutePath),
    bytes: await readFile(absolutePath)
  };
}

function safeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function viewportId(viewport?: StoryImageViewport) {
  return safeId(
    viewport?.scope || viewport?.label ||
      (viewport?.width || viewport?.height
        ? `${viewport.width || 'auto'}x${viewport.height || 'auto'}`
        : 'shared')
  );
}

function imageIdPrefix(storyId: string, slotId: string, viewport?: StoryImageViewport) {
  return `${safeId(storyId)}--${safeId(slotId)}--${viewportId(viewport)}--`;
}

async function uploadAsset(input: {
  config: ReturnType<typeof readConfig>;
  imageId: string;
  asset: Awaited<ReturnType<typeof imageAsset>>;
  fetchImpl: Fetch;
}) {
  const url = new URL(input.config.uploadUrl);
  url.searchParams.set('projectId', input.config.projectId);
  url.searchParams.set('imageId', input.imageId);
  const response = await input.fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': input.asset.mimeType },
    body: new Uint8Array(input.asset.bytes),
    signal: AbortSignal.timeout(60_000)
  });
  const body = (await response.json().catch(() => null)) as
    | (Partial<AssetHubImage> & { error?: string })
    | null;
  if (!response.ok || !body?.imageId || !body.imageUrl || !body.storageKey) {
    throw new Error(
      `Asset Hub upload failed: ${body?.error || `${response.status} ${response.statusText}`}`
    );
  }
  return body as AssetHubImage;
}

export async function uploadStoryImage(input: {
  storyId: string;
  slotId: string;
  imagePath: string;
  viewport?: StoryImageViewport;
}, options: ImageStoreOptions = {}) {
  const config = readConfig(options.env);
  const [{ storyId, target }, asset] = await Promise.all([
    storyTarget(
      input.storyId,
      input.slotId,
      input.viewport,
      config.projectId,
      options.env,
      options.fetchImpl
    ),
    imageAsset(input.imagePath)
  ]);
  const imageId = `${imageIdPrefix(storyId, input.slotId, input.viewport)}${randomUUID()}`;
  const image = await uploadAsset({
    config,
    imageId,
    asset,
    fetchImpl: options.fetchImpl ?? fetch
  });
  return { storyId, slotId: input.slotId, sourcePath: asset.path, target, image };
}

export async function updateStoryImage(input: {
  storyId: string;
  slotId: string;
  imageId: string;
  imagePath: string;
  viewport?: StoryImageViewport;
}, options: ImageStoreOptions = {}) {
  const config = readConfig(options.env);
  const [{ storyId, target }, asset] = await Promise.all([
    storyTarget(
      input.storyId,
      input.slotId,
      input.viewport,
      config.projectId,
      options.env,
      options.fetchImpl
    ),
    imageAsset(input.imagePath)
  ]);
  if (!input.imageId.startsWith(imageIdPrefix(storyId, input.slotId, input.viewport))) {
    throw new Error(`Image ${input.imageId} does not belong to ${storyId}/${input.slotId}`);
  }
  const image = await uploadAsset({
    config,
    imageId: input.imageId,
    asset,
    fetchImpl: options.fetchImpl ?? fetch
  });
  return {
    storyId,
    slotId: input.slotId,
    sourcePath: asset.path,
    target,
    replaced: true,
    image
  };
}
