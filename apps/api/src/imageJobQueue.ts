import { randomUUID } from 'node:crypto';
import type {
  GeneratedImage,
  ImageEditFields,
  ImageGenerationRequest,
  ImageHistoryRecord,
  ImageJobRecord
} from '@image-gen-web/shared';
import { logDiagnostic, summarizeImages } from './diagnostics.js';
import type { HistoryStore } from './historyStore.js';
import type { ImageProvider, UploadedImage } from './app.js';

type InternalImageJob = ImageJobRecord & {
  controller: AbortController;
  run: (signal: AbortSignal) => Promise<{ durationMs: number; images: GeneratedImage[]; history?: ImageHistoryRecord }>;
};

type QueueOptions = {
  maxParallel: number;
  maxQueuedJobs: number;
  maxStoredJobs: number;
  provider: ImageProvider;
  historyStore?: HistoryStore;
};

export type ImageJobQueue = ReturnType<typeof createImageJobQueue>;

export function createImageJobQueue(options: QueueOptions) {
  const jobs: InternalImageJob[] = [];
  let runningCount = 0;
  let maxParallel = Math.max(1, options.maxParallel);
  const maxQueuedJobs = Math.max(1, options.maxQueuedJobs);
  const maxStoredJobs = Math.max(1, options.maxStoredJobs);

  function snapshot(job: InternalImageJob): ImageJobRecord {
    const { controller: _controller, run: _run, ...record } = job;
    return { ...record };
  }

  function touch(job: InternalImageJob) {
    job.updatedAt = new Date().toISOString();
  }

  function listJobs(): ImageJobRecord[] {
    return jobs.map(snapshot);
  }

  function getJob(jobId: string): ImageJobRecord | undefined {
    const job = jobs.find((item) => item.id === jobId);
    return job ? snapshot(job) : undefined;
  }

  function retryJob(jobId: string): ImageJobRecord | undefined {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || job.status !== 'failed') {
      return undefined;
    }

    job.status = 'queued';
    delete job.error;
    delete job.startedAt;
    delete job.finishedAt;
    delete job.durationMs;
    delete job.history;
    job.controller = new AbortController();
    touch(job);
    pump();
    return snapshot(job);
  }

  function cancelJob(jobId: string): ImageJobRecord | undefined {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || (job.status !== 'queued' && job.status !== 'running')) {
      return undefined;
    }

    if (job.status === 'running') {
      job.controller.abort();
    }

    job.status = 'canceled';
    job.finishedAt = new Date().toISOString();
    touch(job);
    trimStoredJobs();
    logDiagnostic('image.job.cancel', { jobId: job.id });
    return snapshot(job);
  }

  function stats() {
    return {
      jobs: listJobs(),
      maxParallel,
      maxQueuedJobs,
      maxStoredJobs,
      runningCount,
      queuedCount: jobs.filter((job) => job.status === 'queued').length
    };
  }

  function canEnqueue(): boolean {
    return jobs.filter((job) => job.status === 'queued' || job.status === 'running').length < maxQueuedJobs;
  }

  function setMaxParallel(nextMaxParallel: number): void {
    maxParallel = Math.max(1, nextMaxParallel);
    pump();
  }

  function enqueueGenerate(request: ImageGenerationRequest): ImageJobRecord {
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
      run: async (signal) => {
        const start = Date.now();
        const images = await options.provider.generate(request, signal);
        throwIfCanceled(signal);
        const durationMs = Date.now() - start;
        const history = await options.historyStore?.saveGeneration({ mode: 'text', ...request, durationMs, images });
        return { images, durationMs, history };
      }
    });
    jobs.unshift(job);
    trimStoredJobs();
    pump();
    return snapshot(job);
  }

  function enqueueEdit(fields: ImageEditFields, images: UploadedImage[]): ImageJobRecord {
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
      run: async (signal) => {
        const start = Date.now();
        const generatedImages = await options.provider.edit(fields, images, signal);
        throwIfCanceled(signal);
        const durationMs = Date.now() - start;
        const history = await options.historyStore?.saveGeneration({ mode: 'image', ...fields, durationMs, images: generatedImages });
        return { images: generatedImages, durationMs, history };
      }
    });
    jobs.unshift(job);
    trimStoredJobs();
    pump();
    return snapshot(job);
  }

  function clearFinished(): ImageJobRecord[] {
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      if (jobs[index].status === 'succeeded' || jobs[index].status === 'failed' || jobs[index].status === 'canceled') {
        jobs.splice(index, 1);
      }
    }
    return listJobs();
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
    run: InternalImageJob['run'];
  }): InternalImageJob {
    const now = new Date().toISOString();
    return {
      id: `job_${randomUUID().replaceAll('-', '')}`,
      controller: new AbortController(),
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      mode: input.mode,
      prompt: input.prompt,
      model: input.model,
      size: input.size,
      quality: input.quality,
      imageCount: input.imageCount,
      run: input.run
    };
  }

  function pump() {
    while (runningCount < maxParallel) {
      const nextJob = [...jobs].reverse().find((job) => job.status === 'queued');
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

    void job
      .run(job.controller.signal)
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
      })
      .finally(() => {
        runningCount -= 1;
        pump();
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
