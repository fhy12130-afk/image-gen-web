import { randomUUID } from 'node:crypto';
import type {
  GeneratedImage,
  ImageEditFields,
  ImageGenerationRequest,
  ImageHistoryRecord,
  ImageJobRecord
} from '@image-gen-web/shared';
import { logDiagnostic, summarizeImages } from './diagnostics';
import type { HistoryStore } from './historyStore';
import type { ImageProvider, UploadedImage } from './app';

type InternalImageJob = ImageJobRecord & {
  run: () => Promise<{ durationMs: number; images: GeneratedImage[]; history?: ImageHistoryRecord }>;
};

type QueueOptions = {
  maxParallel: number;
  provider: ImageProvider;
  historyStore?: HistoryStore;
};

export type ImageJobQueue = ReturnType<typeof createImageJobQueue>;

export function createImageJobQueue(options: QueueOptions) {
  const jobs: InternalImageJob[] = [];
  let runningCount = 0;
  const maxParallel = Math.max(1, options.maxParallel);

  function snapshot(job: InternalImageJob): ImageJobRecord {
    const { run: _run, ...record } = job;
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
    touch(job);
    pump();
    return snapshot(job);
  }

  function stats() {
    return {
      jobs: listJobs(),
      maxParallel,
      runningCount,
      queuedCount: jobs.filter((job) => job.status === 'queued').length
    };
  }

  function enqueueGenerate(request: ImageGenerationRequest): ImageJobRecord {
    const job = createJob({
      mode: 'text',
      prompt: request.prompt,
      model: request.model,
      size: request.size,
      quality: request.quality,
      imageCount: 0,
      run: async () => {
        const start = Date.now();
        const images = await options.provider.generate(request);
        const durationMs = Date.now() - start;
        const history = await options.historyStore?.saveGeneration({ mode: 'text', ...request, durationMs, images });
        return { images, durationMs, history };
      }
    });
    jobs.unshift(job);
    pump();
    return snapshot(job);
  }

  function enqueueEdit(fields: ImageEditFields, images: UploadedImage[]): ImageJobRecord {
    const job = createJob({
      mode: 'image',
      prompt: fields.prompt,
      model: fields.model,
      size: fields.size,
      quality: fields.quality,
      imageCount: images.length,
      run: async () => {
        const start = Date.now();
        const generatedImages = await options.provider.edit(fields, images);
        const durationMs = Date.now() - start;
        const history = await options.historyStore?.saveGeneration({ mode: 'image', ...fields, durationMs, images: generatedImages });
        return { images: generatedImages, durationMs, history };
      }
    });
    jobs.unshift(job);
    pump();
    return snapshot(job);
  }

  function clearFinished(): ImageJobRecord[] {
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      if (jobs[index].status === 'succeeded' || jobs[index].status === 'failed') {
        jobs.splice(index, 1);
      }
    }
    return listJobs();
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
      .run()
      .then((result) => {
        job.status = 'succeeded';
        job.durationMs = result.durationMs;
        job.history = result.history;
        job.finishedAt = new Date().toISOString();
        touch(job);
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
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        job.finishedAt = new Date().toISOString();
        touch(job);
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
    getJob,
    listJobs,
    clearFinished,
    stats
  };
}
