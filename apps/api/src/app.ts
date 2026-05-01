import { readFile } from 'node:fs/promises';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import {
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_IMAGE_SIZE,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  apiSettingsUpdateSchema,
  imageEditFieldsSchema,
  imageGenerationRequestSchema,
  type ApiSettingsResponse,
  type GeneratedImage,
  type ImageEditFields,
  type ImageGenerationRequest
} from '@image-gen-web/shared';
import type { ApiConfig } from './config';
import { createRequestId, logDiagnostic, maskForLog, summarizeImages } from './diagnostics';
import { apiError } from './errors';
import type { HistoryStore } from './historyStore';
import { createImageJobQueue } from './imageJobQueue';
import { applySettingsUpdate, toStoredSettings, type SettingsStore } from './settingsStore';

export type UploadedImage = { buffer: Buffer; filename: string; mimetype: string };

export type ImageProvider = {
  generate: (request: ImageGenerationRequest) => Promise<GeneratedImage[]>;
  edit: (fields: ImageEditFields, images: UploadedImage[]) => Promise<GeneratedImage[]>;
};

export function buildApp(options: { config: ApiConfig; provider: ImageProvider; historyStore?: HistoryStore; settingsStore?: SettingsStore }) {
  const app = Fastify({ logger: false });
  const jobQueue = createImageJobQueue({
    maxParallel: options.config.maxParallelImageJobs,
    provider: options.provider,
    historyStore: options.historyStore
  });

  app.register(cors, { origin: options.config.webOrigin });
  app.register(multipart, { limits: { fileSize: 60 * 1024 * 1024, files: 10 } });

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
    supportsImageEdit: true
  }));

  app.get('/api/settings', async () => settingsResponse(options.config));

  app.put('/api/settings', async (request, reply) => {
    const parsed = apiSettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(apiError('VALIDATION_ERROR', 'Invalid settings update.', parsed.error.message));
    }

    applySettingsUpdate(options.config, parsed.data);
    jobQueue.setMaxParallel(options.config.maxParallelImageJobs);
    await options.settingsStore?.saveSettings(toStoredSettings(options.config));

    return settingsResponse(options.config);
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

  app.get('/api/history', async () => ({
    records: options.historyStore ? await options.historyStore.listHistory() : []
  }));

  app.delete('/api/history', async () => {
    await options.historyStore?.clearHistory();
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

  app.get('/api/jobs', async () => jobQueue.stats());

  app.delete('/api/jobs', async () => ({
    jobs: jobQueue.clearFinished(),
    maxParallel: options.config.maxParallelImageJobs,
    runningCount: jobQueue.stats().runningCount,
    queuedCount: jobQueue.stats().queuedCount
  }));

  app.get('/api/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = jobQueue.getJob(jobId);
    if (!job) {
      return reply.status(404).send(apiError('VALIDATION_ERROR', 'Image job was not found.'));
    }

    return { job };
  });

  app.post('/api/jobs/:jobId/retry', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = jobQueue.retryJob(jobId);
    if (!job) {
      return reply.status(400).send(apiError('VALIDATION_ERROR', 'Only failed image jobs can be retried.'));
    }

    return reply.status(202).send({ job });
  });

  app.post('/api/jobs/:jobId/cancel', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = jobQueue.cancelJob(jobId);
    if (!job) {
      return reply.status(400).send(apiError('VALIDATION_ERROR', 'Only queued image jobs can be canceled.'));
    }

    return reply.status(200).send({ job });
  });

  app.post('/api/jobs/image/generate', async (request, reply) => {
    if (!isProviderConfigured(options.config)) {
      return reply.status(400).send(apiError('CONFIG_MISSING', 'Image provider URL and API key are required.'));
    }

    const parsed = imageGenerationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(apiError('VALIDATION_ERROR', 'Invalid image generation job request.', parsed.error.message));
    }

    return reply.status(202).send({ job: jobQueue.enqueueGenerate(parsed.data) });
  });

  app.post('/api/jobs/image/edit', async (request, reply) => {
    if (!isProviderConfigured(options.config)) {
      return reply.status(400).send(apiError('CONFIG_MISSING', 'Image provider URL and API key are required.'));
    }

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

    const parsed = imageEditFieldsSchema.safeParse(fields);
    if (!parsed.success || images.length === 0) {
      return reply.status(400).send(
        apiError(
          'VALIDATION_ERROR',
          'Invalid image edit job request.',
          images.length === 0 ? 'At least one image file is required.' : parsed.error?.message
        )
      );
    }

    return reply.status(202).send({ job: jobQueue.enqueueEdit(parsed.data, images) });
  });

  app.post('/api/image/generate', async (request, reply) => {
    const requestId = createRequestId('generate');
    reply.header('x-request-id', requestId);
    if (!isProviderConfigured(options.config)) {
      return reply.status(400).send(apiError('CONFIG_MISSING', 'Image provider URL and API key are required.'));
    }

    const parsed = imageGenerationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(apiError('VALIDATION_ERROR', 'Invalid image generation request.', parsed.error.message));
    }

    const start = Date.now();
    try {
      logDiagnostic('image.generate.start', {
        requestId,
        model: parsed.data.model,
        size: parsed.data.size,
        quality: parsed.data.quality,
        providerBaseUrl: options.config.baseUrl,
        apiKey: maskForLog(options.config.apiKey)
      });
      const images = await options.provider.generate(parsed.data);
      const durationMs = Date.now() - start;
      const history = await options.historyStore?.saveGeneration({ mode: 'text', ...parsed.data, durationMs, images });
      logDiagnostic('image.generate.success', { requestId, durationMs, imageCount: images.length, historyId: history?.id });
      return { images, durationMs, history };
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      logDiagnostic('image.generate.error', { requestId, durationMs: Date.now() - start, details });
      return reply.status(502).send(apiError('PROVIDER_ERROR', 'Image provider request failed.', details));
    }
  });

  app.post('/api/image/edit', async (request, reply) => {
    const requestId = createRequestId('edit');
    reply.header('x-request-id', requestId);
    if (!isProviderConfigured(options.config)) {
      return reply.status(400).send(apiError('CONFIG_MISSING', 'Image provider URL and API key are required.'));
    }

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

    const parsed = imageEditFieldsSchema.safeParse(fields);
    if (!parsed.success || images.length === 0) {
      return reply.status(400).send(
        apiError(
          'VALIDATION_ERROR',
          'Invalid image edit request.',
          images.length === 0 ? 'At least one image file is required.' : parsed.error?.message
        )
      );
    }

    const start = Date.now();
    try {
      logDiagnostic('image.edit.start', {
        requestId,
        model: parsed.data.model,
        size: parsed.data.size,
        quality: parsed.data.quality,
        imageCount: images.length,
        images: summarizeImages(images),
        providerBaseUrl: options.config.baseUrl,
        apiKey: maskForLog(options.config.apiKey)
      });
      const generatedImages = await options.provider.edit(parsed.data, images);
      const durationMs = Date.now() - start;
      const history = await options.historyStore?.saveGeneration({ mode: 'image', ...parsed.data, durationMs, images: generatedImages });
      logDiagnostic('image.edit.success', { requestId, durationMs, imageCount: generatedImages.length, historyId: history?.id });
      return { images: generatedImages, durationMs, history };
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      logDiagnostic('image.edit.error', { requestId, durationMs: Date.now() - start, details });
      return reply.status(502).send(apiError('PROVIDER_ERROR', 'Image provider request failed.', details));
    }
  });

  return app;
}

function isProviderConfigured(config: ApiConfig): boolean {
  return Boolean(config.baseUrl && config.apiKey);
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
