import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_IMAGE_SIZE,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  imageQualitySchema,
  imageSizeSchema,
  type ImageHistoryRecord,
  type ImageHistoryResponse,
  type ImageJobRecord,
  type ImageJobResponse,
  type ImageJobsResponse,
  type ImageQuality,
  type ImageResponse,
  type PublicConfig
} from '@image-gen-web/shared';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
};

const generateImageInputSchema = z.object({
  prompt: z.string().trim().min(1),
  model: z.string().trim().min(1).optional(),
  size: imageSizeSchema.optional(),
  quality: imageQualitySchema.optional(),
  n: z.number().int().min(1).max(4).optional()
});

const editImageInputSchema = z.object({
  prompt: z.string().trim().min(1),
  imagePaths: z.array(z.string().trim().min(1)).min(1).max(10),
  model: z.string().trim().min(1).optional(),
  size: imageSizeSchema.optional(),
  quality: imageQualitySchema.optional()
});

const listHistoryInputSchema = z.object({
  limit: z.number().int().min(1).max(50).optional()
});

const getHistoryItemInputSchema = z.object({
  historyId: z.string().trim().min(1)
});

const getImageJobInputSchema = z.object({
  jobId: z.string().trim().min(1)
});

export type GenerateImageInput = z.infer<typeof generateImageInputSchema>;
export type EditImageInput = z.infer<typeof editImageInputSchema>;
export type ListHistoryInput = z.infer<typeof listHistoryInputSchema>;
export type GetHistoryItemInput = z.infer<typeof getHistoryItemInputSchema>;
export type GetImageJobInput = z.infer<typeof getImageJobInputSchema>;

export function getApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.IMAGE_GEN_API_URL || 'http://localhost:8700').replace(/\/+$/, '');
}

export function createImageGenMcpServer(apiUrl = getApiUrl()) {
  const server = new McpServer({
    name: 'image-gen-web',
    version: '0.1.0'
  });

  server.tool(
    'generate_image',
    'Generate an image through the local Image Gen Web API.',
    generateImageInputSchema.shape,
    async (input) => generateImageTool(input, apiUrl)
  );

  server.tool(
    'edit_image',
    'Edit an image through the local Image Gen Web API using one or more local reference image paths.',
    editImageInputSchema.shape,
    async (input) => editImageTool(input, apiUrl)
  );

  server.tool(
    'queue_image_generation',
    'Queue a text-to-image job through the local API and return immediately so other jobs can run in parallel.',
    generateImageInputSchema.shape,
    async (input) => queueImageGenerationTool(input, apiUrl)
  );

  server.tool(
    'queue_image_edit',
    'Queue an image edit job through the local API using one or more local reference image paths.',
    editImageInputSchema.shape,
    async (input) => queueImageEditTool(input, apiUrl)
  );

  server.tool('list_image_jobs', 'List queued, running, succeeded, and failed image jobs.', {}, async () =>
    listImageJobsTool(apiUrl)
  );

  server.tool(
    'get_image_job',
    'Return one queued/running/finished image job by id.',
    getImageJobInputSchema.shape,
    async (input) => getImageJobTool(input, apiUrl)
  );

  server.tool(
    'retry_image_job',
    'Retry a failed image job without resubmitting the original prompt or reference images.',
    getImageJobInputSchema.shape,
    async (input) => retryImageJobTool(input, apiUrl)
  );

  server.tool(
    'cancel_image_job',
    'Cancel a queued image job before it starts running.',
    getImageJobInputSchema.shape,
    async (input) => cancelImageJobTool(input, apiUrl)
  );

  server.tool(
    'list_image_history',
    'List recent image generation history records saved by the local API.',
    listHistoryInputSchema.shape,
    async (input) => listImageHistoryTool(input, apiUrl)
  );

  server.tool(
    'get_image_history_item',
    'Return one image generation history record by id.',
    getHistoryItemInputSchema.shape,
    async (input) => getImageHistoryItemTool(input, apiUrl)
  );

  server.tool('get_image_generation_help', 'Show supported sizes, quality values, and tool examples.', {}, async () =>
    getImageGenerationHelpTool(apiUrl)
  );

  return server;
}

export async function generateImageTool(input: GenerateImageInput, apiUrl = getApiUrl()): Promise<ToolResult> {
  const config = await fetchPublicConfigOrDefault(apiUrl);
  const payload = {
    prompt: input.prompt,
    model: input.model || config.defaultModel,
    size: input.size || config.defaultSize || DEFAULT_IMAGE_SIZE,
    quality: input.quality || config.defaultQuality || DEFAULT_IMAGE_QUALITY,
    n: input.n || 1
  };

  const response = await postJson<ImageResponse>(apiUrl, '/api/image/generate', payload);
  return asTextResult(formatImageResponse('generated', response, apiUrl));
}

export async function editImageTool(input: EditImageInput, apiUrl = getApiUrl()): Promise<ToolResult> {
  const config = await fetchPublicConfigOrDefault(apiUrl);
  const form = new FormData();
  form.set('prompt', input.prompt);
  form.set('model', input.model || config.defaultModel);
  form.set('size', input.size || config.defaultSize || DEFAULT_IMAGE_SIZE);
  form.set('quality', input.quality || config.defaultQuality || DEFAULT_IMAGE_QUALITY);

  for (const imagePath of input.imagePaths) {
    const absolutePath = resolve(imagePath);
    const bytes = await readFile(absolutePath);
    form.append('image', new Blob([new Uint8Array(bytes)], { type: inferMimeType(absolutePath) }), basename(absolutePath));
  }

  const response = await postForm<ImageResponse>(apiUrl, '/api/image/edit', form);
  return asTextResult(formatImageResponse('edited', response, apiUrl));
}

export async function queueImageGenerationTool(input: GenerateImageInput, apiUrl = getApiUrl()): Promise<ToolResult> {
  const config = await fetchPublicConfigOrDefault(apiUrl);
  const payload = {
    prompt: input.prompt,
    model: input.model || config.defaultModel,
    size: input.size || config.defaultSize || DEFAULT_IMAGE_SIZE,
    quality: input.quality || config.defaultQuality || DEFAULT_IMAGE_QUALITY,
    n: input.n || 1
  };

  const response = await postJson<ImageJobResponse>(apiUrl, '/api/jobs/image/generate', payload);
  return asTextResult({
    queued: true,
    maxParallelImageJobs: config.maxParallelImageJobs,
    job: formatImageJob(response.job, apiUrl)
  });
}

export async function queueImageEditTool(input: EditImageInput, apiUrl = getApiUrl()): Promise<ToolResult> {
  const config = await fetchPublicConfigOrDefault(apiUrl);
  const form = new FormData();
  form.set('prompt', input.prompt);
  form.set('model', input.model || config.defaultModel);
  form.set('size', input.size || config.defaultSize || DEFAULT_IMAGE_SIZE);
  form.set('quality', input.quality || config.defaultQuality || DEFAULT_IMAGE_QUALITY);

  for (const imagePath of input.imagePaths) {
    const absolutePath = resolve(imagePath);
    const bytes = await readFile(absolutePath);
    form.append('image', new Blob([new Uint8Array(bytes)], { type: inferMimeType(absolutePath) }), basename(absolutePath));
  }

  const response = await postForm<ImageJobResponse>(apiUrl, '/api/jobs/image/edit', form);
  return asTextResult({
    queued: true,
    maxParallelImageJobs: config.maxParallelImageJobs,
    job: formatImageJob(response.job, apiUrl)
  });
}

export async function listImageJobsTool(apiUrl = getApiUrl()): Promise<ToolResult> {
  const response = await getJson<ImageJobsResponse>(apiUrl, '/api/jobs');
  return asTextResult({
    maxParallel: response.maxParallel,
    runningCount: response.runningCount,
    queuedCount: response.queuedCount,
    jobs: response.jobs.map((job) => formatImageJob(job, apiUrl))
  });
}

export async function getImageJobTool(input: GetImageJobInput, apiUrl = getApiUrl()): Promise<ToolResult> {
  const response = await getJson<ImageJobResponse>(apiUrl, `/api/jobs/${encodeURIComponent(input.jobId)}`);
  return asTextResult(formatImageJob(response.job, apiUrl));
}

export async function retryImageJobTool(input: GetImageJobInput, apiUrl = getApiUrl()): Promise<ToolResult> {
  const response = await postJson<ImageJobResponse>(apiUrl, `/api/jobs/${encodeURIComponent(input.jobId)}/retry`, {});
  return asTextResult(formatImageJob(response.job, apiUrl));
}

export async function cancelImageJobTool(input: GetImageJobInput, apiUrl = getApiUrl()): Promise<ToolResult> {
  const response = await postJson<ImageJobResponse>(apiUrl, `/api/jobs/${encodeURIComponent(input.jobId)}/cancel`, {});
  return asTextResult(formatImageJob(response.job, apiUrl));
}

export async function listImageHistoryTool(input: ListHistoryInput = {}, apiUrl = getApiUrl()): Promise<ToolResult> {
  const response = await getJson<ImageHistoryResponse>(apiUrl, '/api/history');
  const limit = input.limit || 10;
  return asTextResult({
    records: response.records.slice(0, limit).map((record) => formatHistoryRecord(record, apiUrl))
  });
}

export async function getImageHistoryItemTool(input: GetHistoryItemInput, apiUrl = getApiUrl()): Promise<ToolResult> {
  const response = await getJson<ImageHistoryResponse>(apiUrl, '/api/history');
  const record = response.records.find((item) => item.id === input.historyId);
  if (!record) {
    throw new Error(`History record not found: ${input.historyId}`);
  }

  return asTextResult(formatHistoryRecord(record, apiUrl));
}

export async function getImageGenerationHelpTool(apiUrl = getApiUrl()): Promise<ToolResult> {
  const config = await fetchPublicConfigOrDefault(apiUrl);
  return asTextResult({
    apiUrl,
    tools: ['generate_image', 'edit_image', 'list_image_history', 'get_image_history_item'],
    asyncTools: ['queue_image_generation', 'queue_image_edit', 'list_image_jobs', 'get_image_job', 'retry_image_job', 'cancel_image_job'],
    defaults: {
      model: config.defaultModel,
      size: config.defaultSize,
      quality: config.defaultQuality,
      maxParallelImageJobs: config.maxParallelImageJobs
    },
    supportedSizes: config.sizes,
    supportedQualities: config.qualities,
    examples: [
      {
        tool: 'generate_image',
        input: { prompt: 'product photo on a clean studio table', size: '2048x2048', quality: 'high' }
      },
      {
        tool: 'edit_image',
        input: { prompt: 'make the background minimal', imagePaths: ['D:/images/reference.png'], quality: 'medium' }
      },
      {
        tool: 'queue_image_generation',
        input: { prompt: 'five product variations', size: '3840x2160', quality: 'high' }
      },
      {
        tool: 'list_image_jobs',
        input: {}
      }
    ]
  });
}

async function fetchPublicConfigOrDefault(apiUrl: string): Promise<PublicConfig> {
  try {
    const response = await getJson<Partial<PublicConfig>>(apiUrl, '/api/config/public');
    return {
      defaultModel: response.defaultModel || 'gptimage2',
      defaultSize: response.defaultSize || DEFAULT_IMAGE_SIZE,
      sizes: response.sizes?.length ? response.sizes : [...IMAGE_SIZE_OPTIONS],
      defaultQuality: response.defaultQuality || DEFAULT_IMAGE_QUALITY,
      qualities: response.qualities?.length ? response.qualities : [...IMAGE_QUALITY_OPTIONS],
      maxParallelImageJobs: response.maxParallelImageJobs || 2,
      supportsImageEdit: response.supportsImageEdit ?? true
    };
  } catch {
    return {
      defaultModel: 'gptimage2',
      defaultSize: DEFAULT_IMAGE_SIZE,
      sizes: [...IMAGE_SIZE_OPTIONS],
      defaultQuality: DEFAULT_IMAGE_QUALITY,
      qualities: [...IMAGE_QUALITY_OPTIONS],
      maxParallelImageJobs: 2,
      supportsImageEdit: true
    };
  }
}

async function getJson<T>(apiUrl: string, path: string): Promise<T> {
  return parseApiResponse<T>(await fetch(`${apiUrl}${path}`));
}

async function postJson<T>(apiUrl: string, path: string, body: unknown): Promise<T> {
  return parseApiResponse<T>(
    await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
}

async function postForm<T>(apiUrl: string, path: string, body: FormData): Promise<T> {
  return parseApiResponse<T>(
    await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      body
    })
  );
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = parseJsonOrNull(text);
  if (!response.ok) {
    const message = extractApiErrorMessage(payload) || text || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

function parseJsonOrNull(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) {
    return null;
  }

  const error = (payload as { error?: { message?: unknown; details?: unknown } }).error;
  if (typeof error?.details === 'string' && error.details) {
    return error.details;
  }

  return typeof error?.message === 'string' ? error.message : null;
}

function formatImageResponse(action: 'generated' | 'edited', response: ImageResponse, apiUrl: string) {
  return {
    action,
    historyId: response.history?.id || null,
    durationMs: response.durationMs,
    images:
      response.history?.images.map((image) => ({
        id: image.id,
        url: absoluteApiUrl(apiUrl, image.url),
        downloadUrl: absoluteApiUrl(apiUrl, image.downloadUrl),
        fileName: image.fileName,
        mimeType: image.mimeType,
        bytes: image.bytes
      })) ||
      response.images.map((image, index) => ({
        id: `provider_${index + 1}`,
        url: image.url,
        b64Json: image.b64Json,
        downloadUrl: image.url ? `${apiUrl}/api/image/download?url=${encodeURIComponent(image.url)}` : null
      }))
  };
}

function formatHistoryRecord(record: ImageHistoryRecord, apiUrl = '') {
  return {
    id: record.id,
    createdAt: record.createdAt,
    mode: record.mode,
    prompt: record.prompt,
    model: record.model,
    size: record.size,
    quality: record.quality || null,
    durationMs: record.durationMs,
    images: record.images.map((image) => ({
      id: image.id,
      url: absoluteApiUrl(apiUrl, image.url),
      downloadUrl: absoluteApiUrl(apiUrl, image.downloadUrl),
      fileName: image.fileName,
      mimeType: image.mimeType,
      bytes: image.bytes
    }))
  };
}

function formatImageJob(job: ImageJobRecord, apiUrl = '') {
  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    status: job.status,
    mode: job.mode,
    prompt: job.prompt,
    model: job.model,
    size: job.size,
    quality: job.quality,
    imageCount: job.imageCount,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    durationMs: job.durationMs ?? null,
    error: job.error ?? null,
    history: job.history ? formatHistoryRecord(job.history, apiUrl) : null
  };
}

function asTextResult(payload: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
  };
}

function absoluteApiUrl(apiUrl: string, pathOrUrl: string | null): string | null {
  if (!pathOrUrl || !pathOrUrl.startsWith('/')) {
    return pathOrUrl;
  }

  return `${apiUrl}${pathOrUrl}`;
}

function inferMimeType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }

  if (extension === '.webp') {
    return 'image/webp';
  }

  return 'image/png';
}

export async function main() {
  const transport = new StdioServerTransport();
  await createImageGenMcpServer().connect(transport);
}

function isMainModule() {
  return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
