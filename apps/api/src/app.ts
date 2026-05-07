import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import Fastify from 'fastify';
import {
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_IMAGE_SIZE,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  imageEditFieldsSchema,
  imageGenerationRequestSchema,
  imageJobRetryRequestSchema,
  type ApiSettingsResponse,
  type ClientJobSettings,
  type GeneratedImage,
  type ImageEditFields,
  type ImageGenerationRequest,
  type ProviderCredentials
} from '@image-gen-web/shared';
import { normalizeBaseUrl, type ApiConfig } from './config.js';
import { createRequestId, logDiagnostic, maskForLog, summarizeImages } from './diagnostics.js';
import { apiError } from './errors.js';
import type { HistoryStore } from './historyStore.js';
import { createImageJobQueue } from './imageJobQueue.js';
import type { SettingsStore } from './settingsStore.js';
import type { TelemetryStore } from './telemetryStore.js';

export type UploadedImage = { buffer: Buffer; filename: string; mimetype: string };
export type ResolvedProviderCredentials = ProviderCredentials & { baseUrl: string };
export type ProviderTelemetryCapture = {
  upstreamRequest?: unknown;
  upstreamResponse?: unknown;
};
export type ProviderRequestContext = {
  requestId?: string;
  jobId?: string;
  clientId?: string;
  telemetry?: ProviderTelemetryCapture;
};

export type ImageProvider = {
  generate: (
    request: ImageGenerationRequest,
    provider: ResolvedProviderCredentials,
    signal?: AbortSignal,
    context?: ProviderRequestContext
  ) => Promise<GeneratedImage[]>;
  edit: (
    fields: ImageEditFields,
    images: UploadedImage[],
    provider: ResolvedProviderCredentials,
    signal?: AbortSignal,
    context?: ProviderRequestContext
  ) => Promise<GeneratedImage[]>;
};

export type AppRuntime = {
  config: ApiConfig;
  jobQueue: ReturnType<typeof createImageJobQueue>;
  settingsStore?: SettingsStore;
  telemetryStore?: TelemetryStore;
};

export function buildApp(options: {
  config: ApiConfig;
  provider: ImageProvider;
  historyStore?: HistoryStore;
  settingsStore?: SettingsStore;
  telemetryStore?: TelemetryStore;
  staticDir?: string;
}) {
  const app = Fastify({ logger: false });
  const requestStartTimes = new WeakMap<object, number>();
  const requestIds = new WeakMap<object, string>();
  const jobQueue = createImageJobQueue({
    maxParallel: options.config.maxParallelImageJobs,
    maxUserParallel: options.config.maxUserParallelImageJobs || options.config.maxParallelImageJobs,
    maxQueuedJobs: options.config.maxQueuedImageJobs,
    maxStoredJobs: options.config.maxStoredImageJobs,
    provider: options.provider,
    historyStore: options.historyStore,
    telemetryStore: options.telemetryStore
  });
  const runtime: AppRuntime = {
    config: options.config,
    jobQueue,
    settingsStore: options.settingsStore,
    telemetryStore: options.telemetryStore
  };

  app.register(cors, { origin: options.config.webOrigin });
  app.register(multipart, { limits: { fileSize: 60 * 1024 * 1024, files: 10 } });

  app.addHook('onRequest', async (request, reply) => {
    const requestId = createRequestId(requestIdPrefixForUrl(request.url));
    requestStartTimes.set(request, Date.now());
    requestIds.set(request, requestId);
    reply.header('x-request-id', requestId);
  });

  app.addHook('onResponse', async (request, reply) => {
    if (!request.url.startsWith('/api/')) {
      return;
    }

    const requestId = String(reply.getHeader('x-request-id') || requestIds.get(request) || '');
    const durationMs = Date.now() - (requestStartTimes.get(request) || Date.now());
    await options.telemetryStore?.record({
      type: 'http.request',
      level: reply.statusCode >= 400 ? 'error' : 'info',
      requestId,
      clientId: clientIdFromQuery(request.query),
      method: request.method,
      url: stripSensitiveQuery(request.url),
      statusCode: reply.statusCode,
      durationMs
    });
  });

  app.setErrorHandler((error, _request, reply) => {
    const normalizedError = error as { statusCode?: number; message?: string };
    const statusCode = normalizedError.statusCode || 500;
    const code = statusCode === 413 ? 'VALIDATION_ERROR' : 'PROVIDER_ERROR';
    const message = statusCode === 413 ? 'Uploaded images are too large. Each image must be 60MB or smaller.' : 'Unexpected API error.';
    logDiagnostic('api.error', { statusCode, message: normalizedError.message || String(error) });
    return reply.status(statusCode).send(apiError(code, message, normalizedError.message || String(error)));
  });

  app.get('/api/config/public', async () => ({
    defaultModel: options.config.defaultModel,
    defaultSize: DEFAULT_IMAGE_SIZE,
    sizes: [...IMAGE_SIZE_OPTIONS],
    defaultQuality: DEFAULT_IMAGE_QUALITY,
    qualities: [...IMAGE_QUALITY_OPTIONS],
    maxParallelImageJobs: options.config.maxParallelImageJobs,
    maxUserParallelImageJobs: options.config.maxUserParallelImageJobs || options.config.maxParallelImageJobs,
    supportsImageEdit: true
  }));

  app.get('/api/settings', async () => settingsResponse(options.config));

  app.put('/api/settings', async (_request, reply) => {
    return reply.status(403).send(apiError('VALIDATION_ERROR', 'Server settings are read-only for public users.'));
  });

  app.get('/api/image/download', async (request, reply) => {
    const rawUrl = (request.query as { url?: string }).url;
    if (!rawUrl) {
      return reply.status(400).send(apiError('VALIDATION_ERROR', 'Download URL is required.'));
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return reply.status(400).send(apiError('VALIDATION_ERROR', 'Download URL is invalid.'));
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return reply.status(400).send(apiError('VALIDATION_ERROR', 'Only HTTP and HTTPS image URLs can be downloaded.'));
    }

    try {
      const response = await fetch(parsedUrl);
      if (!response.ok) {
        return reply.status(502).send(apiError('PROVIDER_ERROR', 'Remote image download failed.', response.statusText));
      }

      const contentType = response.headers.get('content-type') || 'image/png';
      const extension = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
      const buffer = Buffer.from(await response.arrayBuffer());

      return reply
        .header('content-type', contentType)
        .header('content-disposition', `attachment; filename="generated-image.${extension}"`)
        .send(buffer);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      return reply.status(502).send(apiError('PROVIDER_ERROR', 'Remote image download failed.', details));
    }
  });

  app.get('/api/history', async (request) => ({
    records: options.historyStore ? await options.historyStore.listHistory(clientIdFromQuery(request.query)) : []
  }));

  app.delete('/api/history', async (request) => {
    await options.historyStore?.clearHistory(clientIdFromQuery(request.query));
    return { records: [] };
  });

  app.get('/api/history/image/:fileName', async (request, reply) => {
    if (!options.historyStore) {
      return reply.status(404).send(apiError('VALIDATION_ERROR', 'History storage is not configured.'));
    }

    const { fileName } = request.params as { fileName: string };
    const download = (request.query as { download?: string }).download === '1';
    const imagePath = options.historyStore.getImagePath(fileName);
    const extension = fileName.toLowerCase().split('.').pop();
    const contentType = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : 'image/png';

    if (download) {
      reply.header('content-disposition', `attachment; filename="${fileName}"`);
    }

    return reply.type(contentType).send(await readFile(imagePath));
  });

  app.get('/api/jobs', async (request) => jobQueue.stats(clientIdFromQuery(request.query)));

  app.delete('/api/jobs', async (request) => {
    const clientId = clientIdFromQuery(request.query);
    const stats = jobQueue.stats(clientId);
    return {
      jobs: jobQueue.clearFinished(clientId),
      maxParallel: options.config.maxParallelImageJobs,
      runningCount: stats.runningCount,
      queuedCount: stats.queuedCount
    };
  });

  app.get('/api/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = jobQueue.getJob(jobId, clientIdFromQuery(request.query));
    if (!job) {
      return reply.status(404).send(apiError('VALIDATION_ERROR', 'Image job was not found.'));
    }

    return { job };
  });

  app.post('/api/jobs/:jobId/retry', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const parsed = imageJobRetryRequestSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send(apiError('VALIDATION_ERROR', 'Invalid image job retry request.', parsed.error.message));
    }

    const client = resolveClientSettings(options.config, request, parsed.data.client);
    const existingJob = jobQueue.getJob(jobId, client.id);
    if (!existingJob || existingJob.status !== 'failed') {
      return reply.status(400).send(apiError('VALIDATION_ERROR', 'Only failed image jobs can be retried.'));
    }

    const providerCredentials = resolveProviderCredentials(options.config, parsed.data.provider);
    if (!providerCredentials) {
      return reply.status(400).send(apiError('CONFIG_MISSING', 'Image provider URL and API key are required.'));
    }

    const job = jobQueue.retryJob(jobId, providerCredentials, client, requestIdFor(request));
    if (!job) {
      return reply.status(400).send(apiError('VALIDATION_ERROR', 'Only failed image jobs can be retried.'));
    }

    return reply.status(202).send({ job });
  });

  app.post('/api/jobs/:jobId/cancel', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = jobQueue.cancelJob(jobId, clientIdFromQuery(request.query), requestIdFor(request));
    if (!job) {
      return reply.status(400).send(apiError('VALIDATION_ERROR', 'Only queued or running image jobs can be canceled.'));
    }

    return reply.status(200).send({ job });
  });

  app.post('/api/jobs/image/generate', async (request, reply) => {
    const parsed = imageGenerationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(apiError('VALIDATION_ERROR', 'Invalid image generation job request.', parsed.error.message));
    }

    if (!jobQueue.canEnqueue()) {
      return reply.status(429).send(apiError('VALIDATION_ERROR', 'Image job queue is full. Try again after an active job finishes.'));
    }

    const client = resolveClientSettings(options.config, request, parsed.data.client);
    await recordFrontendRequest(options.telemetryStore, {
      requestId: requestIdFor(request),
      clientId: client.id,
      type: 'image.request',
      body: parsed.data
    });
    const providerCredentials = resolveProviderCredentials(options.config, parsed.data.provider);
    if (!providerCredentials) {
      return reply.status(400).send(apiError('CONFIG_MISSING', 'Image provider URL and API key are required.'));
    }

    return reply.status(202).send({ job: jobQueue.enqueueGenerate(parsed.data, providerCredentials, client, requestIdFor(request)) });
  });

  app.post('/api/jobs/image/edit', async (request, reply) => {
    const parts = request.parts();
    const fields: Record<string, string> = {};
    const images: UploadedImage[] = [];

    for await (const part of parts) {
      if (part.type === 'file') {
        images.push({
          buffer: await part.toBuffer(),
          filename: part.filename,
          mimetype: part.mimetype
        });
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    const parsed = imageEditFieldsSchema.safeParse(withProviderFromMultipartFields(fields));
    if (!parsed.success || images.length === 0) {
      return reply.status(400).send(
        apiError(
          'VALIDATION_ERROR',
          'Invalid image edit job request.',
          images.length === 0 ? 'At least one image file is required.' : parsed.error?.message
        )
      );
    }

    if (!jobQueue.canEnqueue()) {
      return reply.status(429).send(apiError('VALIDATION_ERROR', 'Image job queue is full. Try again after an active job finishes.'));
    }

    const client = resolveClientSettings(options.config, request, parsed.data.client);
    await recordFrontendRequest(options.telemetryStore, {
      requestId: requestIdFor(request),
      clientId: client.id,
      type: 'image.request',
      body: {
        ...parsed.data,
        images: images.map((image) => ({ filename: image.filename, mimetype: image.mimetype, bytes: image.buffer.byteLength }))
      }
    });
    const providerCredentials = resolveProviderCredentials(options.config, parsed.data.provider);
    if (!providerCredentials) {
      return reply.status(400).send(apiError('CONFIG_MISSING', 'Image provider URL and API key are required.'));
    }

    return reply.status(202).send({ job: jobQueue.enqueueEdit(parsed.data, images, providerCredentials, client, requestIdFor(request)) });
  });

  app.post('/api/image/generate', async (request, reply) => {
    const requestId = requestIdFor(request) || createRequestId('generate');
    reply.header('x-request-id', requestId);

    const parsed = imageGenerationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(apiError('VALIDATION_ERROR', 'Invalid image generation request.', parsed.error.message));
    }

    const providerCredentials = resolveProviderCredentials(options.config, parsed.data.provider);
    if (!providerCredentials) {
      return reply.status(400).send(apiError('CONFIG_MISSING', 'Image provider URL and API key are required.'));
    }
    const client = resolveClientSettings(options.config, request, parsed.data.client);
    await recordFrontendRequest(options.telemetryStore, {
      requestId,
      clientId: client.id,
      type: 'image.request',
      body: parsed.data
    });

    const start = Date.now();
    const providerTelemetry: ProviderTelemetryCapture = {};
    try {
      logDiagnostic('image.generate.start', {
        requestId,
        model: parsed.data.model,
        size: parsed.data.size,
        quality: parsed.data.quality,
        providerBaseUrl: providerCredentials.baseUrl,
        apiKey: maskForLog(providerCredentials.apiKey)
      });
      const images = await options.provider.generate(parsed.data, providerCredentials, undefined, {
        requestId,
        clientId: client.id,
        telemetry: providerTelemetry
      });
      const durationMs = Date.now() - start;
      const { provider: _provider, ...historyInput } = parsed.data;
      const history = await options.historyStore?.saveGeneration({ clientId: client.id, mode: 'text', ...historyInput, durationMs, images });
      logDiagnostic('image.generate.success', { requestId, durationMs, imageCount: images.length, historyId: history?.id });
      await options.telemetryStore?.record({
        type: 'image.success',
        level: 'info',
        requestId,
        clientId: client.id,
        status: 'succeeded',
        mode: 'text',
        model: parsed.data.model,
        size: parsed.data.size,
        quality: parsed.data.quality,
        providerBaseUrl: providerCredentials.baseUrl,
        durationMs,
        prompt: parsed.data.prompt,
        upstreamRequest: providerTelemetry.upstreamRequest,
        upstreamResponse: providerTelemetry.upstreamResponse,
        details: { imageCount: images.length, historyId: history?.id }
      });
      return { images, durationMs, history };
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      logDiagnostic('image.generate.error', { requestId, durationMs: Date.now() - start, details });
      await options.telemetryStore?.record({
        type: 'image.failure',
        level: 'error',
        requestId,
        clientId: client.id,
        status: 'failed',
        mode: 'text',
        model: parsed.data.model,
        size: parsed.data.size,
        quality: parsed.data.quality,
        providerBaseUrl: providerCredentials.baseUrl,
        durationMs: Date.now() - start,
        prompt: parsed.data.prompt,
        upstreamRequest: providerTelemetry.upstreamRequest,
        upstreamResponse: providerTelemetry.upstreamResponse,
        error: details
      });
      return reply.status(502).send(apiError('PROVIDER_ERROR', 'Image provider request failed.', details));
    }
  });

  app.post('/api/image/edit', async (request, reply) => {
    const requestId = requestIdFor(request) || createRequestId('edit');
    reply.header('x-request-id', requestId);

    const parts = request.parts();
    const fields: Record<string, string> = {};
    const images: UploadedImage[] = [];

    for await (const part of parts) {
      if (part.type === 'file') {
        images.push({
          buffer: await part.toBuffer(),
          filename: part.filename,
          mimetype: part.mimetype
        });
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    const parsed = imageEditFieldsSchema.safeParse(withProviderFromMultipartFields(fields));
    if (!parsed.success || images.length === 0) {
      return reply.status(400).send(
        apiError(
          'VALIDATION_ERROR',
          'Invalid image edit request.',
          images.length === 0 ? 'At least one image file is required.' : parsed.error?.message
        )
      );
    }

    const providerCredentials = resolveProviderCredentials(options.config, parsed.data.provider);
    if (!providerCredentials) {
      return reply.status(400).send(apiError('CONFIG_MISSING', 'Image provider URL and API key are required.'));
    }
    const client = resolveClientSettings(options.config, request, parsed.data.client);
    await recordFrontendRequest(options.telemetryStore, {
      requestId,
      clientId: client.id,
      type: 'image.request',
      body: {
        ...parsed.data,
        images: images.map((image) => ({ filename: image.filename, mimetype: image.mimetype, bytes: image.buffer.byteLength }))
      }
    });

    const start = Date.now();
    const providerTelemetry: ProviderTelemetryCapture = {};
    try {
      logDiagnostic('image.edit.start', {
        requestId,
        model: parsed.data.model,
        size: parsed.data.size,
        quality: parsed.data.quality,
        imageCount: images.length,
        images: summarizeImages(images),
        providerBaseUrl: providerCredentials.baseUrl,
        apiKey: maskForLog(providerCredentials.apiKey)
      });
      const generatedImages = await options.provider.edit(parsed.data, images, providerCredentials, undefined, {
        requestId,
        clientId: client.id,
        telemetry: providerTelemetry
      });
      const durationMs = Date.now() - start;
      const { provider: _provider, ...historyInput } = parsed.data;
      const history = await options.historyStore?.saveGeneration({ clientId: client.id, mode: 'image', ...historyInput, durationMs, images: generatedImages });
      logDiagnostic('image.edit.success', { requestId, durationMs, imageCount: generatedImages.length, historyId: history?.id });
      await options.telemetryStore?.record({
        type: 'image.success',
        level: 'info',
        requestId,
        clientId: client.id,
        status: 'succeeded',
        mode: 'image',
        model: parsed.data.model,
        size: parsed.data.size,
        quality: parsed.data.quality,
        providerBaseUrl: providerCredentials.baseUrl,
        durationMs,
        prompt: parsed.data.prompt,
        upstreamRequest: providerTelemetry.upstreamRequest,
        upstreamResponse: providerTelemetry.upstreamResponse,
        details: { imageCount: generatedImages.length, historyId: history?.id }
      });
      return { images: generatedImages, durationMs, history };
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      logDiagnostic('image.edit.error', { requestId, durationMs: Date.now() - start, details });
      await options.telemetryStore?.record({
        type: 'image.failure',
        level: 'error',
        requestId,
        clientId: client.id,
        status: 'failed',
        mode: 'image',
        model: parsed.data.model,
        size: parsed.data.size,
        quality: parsed.data.quality,
        providerBaseUrl: providerCredentials.baseUrl,
        durationMs: Date.now() - start,
        prompt: parsed.data.prompt,
        upstreamRequest: providerTelemetry.upstreamRequest,
        upstreamResponse: providerTelemetry.upstreamResponse,
        error: details
      });
      return reply.status(502).send(apiError('PROVIDER_ERROR', 'Image provider request failed.', details));
    }
  });

  if (options.staticDir && existsSync(join(options.staticDir, 'index.html'))) {
    app.register(staticPlugin, {
      root: options.staticDir,
      prefix: '/',
      wildcard: false
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send(apiError('VALIDATION_ERROR', 'API route was not found.'));
      }

      return (reply as unknown as { sendFile: (path: string) => unknown }).sendFile('index.html');
    });
  }

  return Object.assign(app, { imageGenRuntime: runtime });

  function requestIdFor(request: object): string {
    return requestIds.get(request) || '';
  }
}

function resolveProviderCredentials(config: ApiConfig, requestProvider?: ProviderCredentials): ResolvedProviderCredentials | null {
  const baseUrl = requestProvider?.baseUrl?.trim() || config.baseUrl;
  const apiKey = requestProvider?.apiKey || config.apiKey;
  if (!baseUrl || !apiKey) {
    return null;
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey: apiKey.trim()
  };
}

function withProviderFromMultipartFields(fields: Record<string, string>): Record<string, unknown> {
  const { providerBaseUrl, providerApiKey, clientId, clientMaxParallelJobs, ...rest } = fields;
  const output: Record<string, unknown> = { ...rest };

  if (!providerBaseUrl && !providerApiKey) {
    if (clientId || clientMaxParallelJobs) {
      output.client = {
        id: clientId || '',
        maxParallelJobs: Number(clientMaxParallelJobs || 2)
      };
    }
    return output;
  }

  output.provider = {
    ...(providerBaseUrl ? { baseUrl: providerBaseUrl } : {}),
    apiKey: providerApiKey || ''
  };
  if (clientId || clientMaxParallelJobs) {
    output.client = {
      id: clientId || '',
      maxParallelJobs: Number(clientMaxParallelJobs || 2)
    };
  }

  return output;
}

function resolveClientSettings(config: ApiConfig, request: { ip?: string; query?: unknown }, requestClient?: ClientJobSettings): ClientJobSettings {
  const query = request.query as { clientId?: string; clientMaxParallelJobs?: string } | undefined;
  const id = requestClient?.id || query?.clientId || request.ip || 'anonymous';
  const requestedParallel = requestClient?.maxParallelJobs ?? Number(query?.clientMaxParallelJobs || 2);
  const maxUserParallel = Math.max(1, config.maxUserParallelImageJobs || config.maxParallelImageJobs);

  return {
    id,
    maxParallelJobs: Math.min(maxUserParallel, Math.max(1, Number.isFinite(requestedParallel) ? requestedParallel : 1))
  };
}

function clientIdFromQuery(query: unknown): string | undefined {
  const clientId = (query as { clientId?: unknown } | undefined)?.clientId;
  return typeof clientId === 'string' && clientId.trim() ? clientId.trim() : undefined;
}

async function recordFrontendRequest(
  telemetryStore: TelemetryStore | undefined,
  input: { requestId: string; clientId: string; type: string; body: unknown }
): Promise<void> {
  await telemetryStore?.record({
    type: input.type,
    level: 'info',
    requestId: input.requestId,
    clientId: input.clientId,
    requestBody: input.body
  });
}

function stripSensitiveQuery(url: string): string {
  try {
    const parsed = new URL(url, 'http://localhost');
    for (const key of [...parsed.searchParams.keys()]) {
      if (/key|token|secret|password/i.test(key)) {
        parsed.searchParams.set(key, '<redacted>');
      }
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url.replace(/(key|token|secret|password)=([^&]+)/gi, '$1=<redacted>');
  }
}

function requestIdPrefixForUrl(url: string): string {
  if (url.startsWith('/api/image/generate')) {
    return 'generate';
  }

  if (url.startsWith('/api/image/edit')) {
    return 'edit';
  }

  return 'request';
}

function settingsResponse(config: ApiConfig): ApiSettingsResponse {
  return {
    baseUrl: config.baseUrl,
    defaultModel: config.defaultModel,
    maxParallelImageJobs: config.maxParallelImageJobs,
    hasApiKey: Boolean(config.apiKey),
    ...(config.apiKey ? { apiKeyPreview: maskForLog(config.apiKey) } : {})
  };
}
