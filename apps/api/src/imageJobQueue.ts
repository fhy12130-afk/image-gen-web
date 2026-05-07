import { randomUUID } from 'node:crypto';
import type {
  ClientJobSettings,
  GeneratedImage,
  ImageEditFields,
  ImageGenerationRequest,
  ImageHistoryRecord,
  ImageJobRecord
} from '@image-gen-web/shared';
import { logDiagnostic, summarizeImages } from './diagnostics.js';
import type { HistoryStore } from './historyStore.js';
import type { ImageProvider, ProviderTelemetryCapture, ResolvedProviderCredentials, UploadedImage } from './app.js';
import type { TelemetryStore } from './telemetryStore.js';

type InternalImageJob = ImageJobRecord & {
  controller: AbortController;
  clientId: string;
  clientMaxParallelJobs: number;
  requestId?: string;
  provider?: ResolvedProviderCredentials;
  n?: number;
  uploadedImages?: UploadedImage[];
  upstreamRequest?: unknown;
  upstreamResponse?: unknown;
};

type QueueOptions = {
  maxParallel: number;
  maxUserParallel: number;
  maxQueuedJobs: number;
  maxStoredJobs: number;
  provider: ImageProvider;
  historyStore?: HistoryStore;
  telemetryStore?: TelemetryStore;
};

export type ImageJobQueue = ReturnType<typeof createImageJobQueue>;

export function createImageJobQueue(options: QueueOptions) {
  const jobs: InternalImageJob[] = [];
  let runningCount = 0;
  let maxParallel = Math.max(1, options.maxParallel);
  const maxUserParallel = Math.max(1, options.maxUserParallel);
  const maxQueuedJobs = Math.max(1, options.maxQueuedJobs);
  const maxStoredJobs = Math.max(1, options.maxStoredJobs);

  function snapshot(job: InternalImageJob): ImageJobRecord {
    const {
      controller: _controller,
      clientId: _clientId,
      clientMaxParallelJobs: _clientMaxParallelJobs,
      provider: _provider,
      n: _n,
      uploadedImages: _uploadedImages,
      ...record
    } = job;
    return { ...record };
  }

  function touch(job: InternalImageJob) {
    job.updatedAt = new Date().toISOString();
  }

  function listJobs(clientId?: string): ImageJobRecord[] {
    return filteredJobs(clientId).map(snapshot);
  }

  function filteredJobs(clientId?: string): InternalImageJob[] {
    return clientId ? jobs.filter((job) => job.clientId === clientId) : jobs;
  }

  function clientRunningCount(clientId: string): number {
    return jobs.filter((job) => job.clientId === clientId && job.status === 'running').length;
  }

  function normalizeClientParallel(value: number): number {
    return Math.min(maxUserParallel, Math.max(1, value || 1));
  }

  function getJob(jobId: string, clientId?: string): ImageJobRecord | undefined {
    const job = jobs.find((item) => item.id === jobId);
    if (clientId && job?.clientId !== clientId) {
      return undefined;
    }
    return job ? snapshot(job) : undefined;
  }

  function retryJob(jobId: string, provider: ResolvedProviderCredentials, client: ClientJobSettings, requestId?: string): ImageJobRecord | undefined {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || job.clientId !== client.id || job.status !== 'failed') {
      return undefined;
    }

    job.status = 'queued';
    delete job.error;
    delete job.startedAt;
    delete job.finishedAt;
    delete job.durationMs;
    delete job.history;
    delete job.upstreamRequest;
    delete job.upstreamResponse;
    job.requestId = requestId || job.requestId;
    job.provider = provider;
    job.clientMaxParallelJobs = normalizeClientParallel(client.maxParallelJobs);
    job.controller = new AbortController();
    touch(job);
    pump();
    return snapshot(job);
  }

  function cancelJob(jobId: string, clientId?: string, requestId?: string): ImageJobRecord | undefined {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || (clientId && job.clientId !== clientId) || (job.status !== 'queued' && job.status !== 'running')) {
      return undefined;
    }

    if (job.status === 'running') {
      job.controller.abort();
    }

    job.status = 'canceled';
    job.finishedAt = new Date().toISOString();
    clearTransientPayload(job);
    touch(job);
    trimStoredJobs();
    logDiagnostic('image.job.cancel', { jobId: job.id });
    return snapshot(job);
  }

  function stats(clientId?: string) {
    const visibleJobs = filteredJobs(clientId);
    return {
      jobs: visibleJobs.map(snapshot),
      maxParallel,
      maxQueuedJobs,
      maxStoredJobs,
      maxUserParallel,
      runningCount: visibleJobs.filter((job) => job.status === 'running').length,
      queuedCount: visibleJobs.filter((job) => job.status === 'queued').length
    };
  }

  function canEnqueue(): boolean {
    return jobs.filter((job) => job.status === 'queued' || job.status === 'running').length < maxQueuedJobs;
  }

  function setMaxParallel(nextMaxParallel: number): void {
    maxParallel = Math.max(1, nextMaxParallel);
    pump();
  }

  function enqueueGenerate(
    request: ImageGenerationRequest,
    provider: ResolvedProviderCredentials,
    client: ClientJobSettings,
    requestId?: string
  ): ImageJobRecord {
    if (!canEnqueue()) {
      throw new Error(`Image job queue is full. Try again after one of the ${maxQueuedJobs} active jobs finishes.`);
    }

    const job = createJob({
      mode: 'text',
      prompt: request.prompt,
      model: request.model,
      size: request.size,
      quality: request.quality,
      imageCount: 0,
      client,
      requestId,
      n: request.n,
      provider
    });
    jobs.unshift(job);
    trimStoredJobs();
    pump();
    return snapshot(job);
  }

  function enqueueEdit(
    fields: ImageEditFields,
    images: UploadedImage[],
    provider: ResolvedProviderCredentials,
    client: ClientJobSettings,
    requestId?: string
  ): ImageJobRecord {
    if (!canEnqueue()) {
      throw new Error(`Image job queue is full. Try again after one of the ${maxQueuedJobs} active jobs finishes.`);
    }

    const job = createJob({
      mode: 'image',
      prompt: fields.prompt,
      model: fields.model,
      size: fields.size,
      quality: fields.quality,
      imageCount: images.length,
      client,
      requestId,
      uploadedImages: images,
      provider
    });
    jobs.unshift(job);
    trimStoredJobs();
    pump();
    return snapshot(job);
  }

  function clearFinished(clientId?: string): ImageJobRecord[] {
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      if (
        (!clientId || jobs[index].clientId === clientId) &&
        (jobs[index].status === 'succeeded' || jobs[index].status === 'failed' || jobs[index].status === 'canceled')
      ) {
        jobs.splice(index, 1);
      }
    }
    return listJobs(clientId);
  }

  function trimStoredJobs() {
    for (let index = jobs.length - 1; jobs.length > maxStoredJobs && index >= 0; index -= 1) {
      const job = jobs[index];
      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') {
        jobs.splice(index, 1);
      }
    }
  }

  function createJob(input: {
    mode: 'text' | 'image';
    prompt: string;
    model: string;
    size: string;
    quality: ImageJobRecord['quality'];
    imageCount: number;
    client: ClientJobSettings;
    requestId?: string;
    provider: ResolvedProviderCredentials;
    n?: number;
    uploadedImages?: UploadedImage[];
  }): InternalImageJob {
    const now = new Date().toISOString();
    return {
      id: `job_${randomUUID().replaceAll('-', '')}`,
      controller: new AbortController(),
      clientId: input.client.id,
      clientMaxParallelJobs: normalizeClientParallel(input.client.maxParallelJobs),
      requestId: input.requestId,
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      mode: input.mode,
      prompt: input.prompt,
      model: input.model,
      size: input.size,
      quality: input.quality,
      imageCount: input.imageCount,
      provider: input.provider,
      n: input.n,
      uploadedImages: input.uploadedImages
    };
  }

  function pump() {
    while (runningCount < maxParallel) {
      const nextJob = [...jobs].reverse().find((job) => job.status === 'queued' && clientRunningCount(job.clientId) < job.clientMaxParallelJobs);
      if (!nextJob) {
        return;
      }
      runJob(nextJob);
    }
  }

  function runJob(job: InternalImageJob) {
    runningCount += 1;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    touch(job);
    logDiagnostic('image.job.start', {
      jobId: job.id,
      mode: job.mode,
      model: job.model,
      size: job.size,
      quality: job.quality,
      imageCount: job.imageCount
    });

    void runJobWork(job, job.controller.signal)
      .then((result) => {
        if (job.status === 'canceled') {
          return;
        }

        job.status = 'succeeded';
        job.durationMs = result.durationMs;
        job.history = result.history;
        job.finishedAt = new Date().toISOString();
        touch(job);
        trimStoredJobs();
        logDiagnostic('image.job.success', {
          jobId: job.id,
          durationMs: result.durationMs,
          imageCount: result.images.length,
          generatedImages: summarizeImages(result.images.map((image, index) => ({
            filename: image.url || `base64-${index + 1}.png`,
            mimetype: 'image/png',
            buffer: Buffer.alloc(0)
          }))),
          historyId: result.history?.id
        });
        void recordJobEvent('image.success', job, {
          durationMs: job.durationMs,
          status: job.status,
          upstreamRequest: result.upstreamRequest,
          upstreamResponse: result.upstreamResponse,
          details: { imageCount: result.images.length, historyId: result.history?.id }
        });
      })
      .catch((error) => {
        if (job.status === 'canceled' || job.controller.signal.aborted) {
          job.status = 'canceled';
          job.finishedAt = job.finishedAt || new Date().toISOString();
          touch(job);
          trimStoredJobs();
          return;
        }

        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        job.finishedAt = new Date().toISOString();
        touch(job);
        trimStoredJobs();
        logDiagnostic('image.job.error', { jobId: job.id, details: job.error });
        void recordJobEvent('image.failure', job, {
          error: job.error,
          status: job.status,
          upstreamRequest: job.upstreamRequest,
          upstreamResponse: job.upstreamResponse
        });
      })
      .finally(() => {
        clearTransientPayload(job);
        runningCount -= 1;
        pump();
      });
  }

  async function runJobWork(
    job: InternalImageJob,
    signal: AbortSignal
  ): Promise<{ durationMs: number; images: GeneratedImage[]; history?: ImageHistoryRecord; upstreamRequest?: unknown; upstreamResponse?: unknown }> {
    const providerCredentials = job.provider;
    if (!providerCredentials) {
      throw new Error('Image provider URL and API key are required.');
    }

    const start = Date.now();
    const providerTelemetry: ProviderTelemetryCapture = {};

    try {
      if (job.mode === 'text') {
        const request = {
          prompt: job.prompt,
          model: job.model,
          size: job.size,
          quality: job.quality,
          n: job.n ?? 1
        };
        const images = await options.provider.generate(request, providerCredentials, signal, {
          requestId: job.requestId,
          jobId: job.id,
          clientId: job.clientId,
          telemetry: providerTelemetry
        });
        throwIfCanceled(signal);
        const durationMs = Date.now() - start;
        const history = await options.historyStore?.saveGeneration({ clientId: job.clientId, mode: 'text', ...request, durationMs, images });
        return { images, durationMs, history, upstreamRequest: providerTelemetry.upstreamRequest, upstreamResponse: providerTelemetry.upstreamResponse };
      }

      const fields = {
        prompt: job.prompt,
        model: job.model,
        size: job.size,
        quality: job.quality
      };
      const images = job.uploadedImages || [];
      const generatedImages = await options.provider.edit(fields, images, providerCredentials, signal, {
        requestId: job.requestId,
        jobId: job.id,
        clientId: job.clientId,
        telemetry: providerTelemetry
      });
      throwIfCanceled(signal);
      const durationMs = Date.now() - start;
      const history = await options.historyStore?.saveGeneration({ clientId: job.clientId, mode: 'image', ...fields, durationMs, images: generatedImages });
      return { images: generatedImages, durationMs, history, upstreamRequest: providerTelemetry.upstreamRequest, upstreamResponse: providerTelemetry.upstreamResponse };
    } catch (error) {
      job.upstreamRequest = providerTelemetry.upstreamRequest;
      job.upstreamResponse = providerTelemetry.upstreamResponse;
      throw error;
    }
  }

  function clearTransientPayload(job: InternalImageJob): void {
    delete job.provider;
    if (job.status !== 'failed') {
      delete job.uploadedImages;
    }
  }

  async function recordJobEvent(
    type: string,
    job: InternalImageJob,
    extra: {
      requestId?: string;
      durationMs?: number;
      error?: string;
      status?: string;
      upstreamRequest?: unknown;
      upstreamResponse?: unknown;
      details?: unknown;
    } = {}
  ) {
    await options.telemetryStore?.record({
      type,
      level: extra.error ? 'error' : 'info',
      requestId: extra.requestId || job.requestId,
      jobId: job.id,
      clientId: job.clientId,
      status: extra.status || job.status,
      mode: job.mode,
      model: job.model,
      size: job.size,
      quality: job.quality,
      providerBaseUrl: job.provider?.baseUrl,
      durationMs: extra.durationMs,
      prompt: job.prompt,
      upstreamRequest: extra.upstreamRequest ?? job.upstreamRequest,
      upstreamResponse: extra.upstreamResponse ?? job.upstreamResponse,
      error: extra.error,
      details: extra.details
    });
  }

  return {
    enqueueGenerate,
    enqueueEdit,
    retryJob,
    cancelJob,
    canEnqueue,
    getJob,
    listJobs,
    clearFinished,
    setMaxParallel,
    stats
  };
}

function throwIfCanceled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('Image job was canceled.');
  }
}
