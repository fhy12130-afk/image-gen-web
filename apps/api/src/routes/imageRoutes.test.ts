import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import type { HistoryStore } from '../historyStore';

function createHistoryStoreStub(): HistoryStore {
  const records: Awaited<ReturnType<HistoryStore['listHistory']>> = [];
  return {
    async saveGeneration(input) {
      const record = {
        id: `hist_${records.length + 1}`,
        createdAt: '2026-04-29T00:00:00.000Z',
        mode: input.mode,
        prompt: input.prompt,
        model: input.model,
        size: input.size,
        quality: input.quality,
        durationMs: input.durationMs,
        images: [
          {
            id: 'img_1',
            fileName: 'img_1.png',
            mimeType: 'image/png',
            bytes: 3,
            url: 'http://localhost:8787/api/history/image/img_1.png',
            downloadUrl: 'http://localhost:8787/api/history/image/img_1.png?download=1'
          }
        ]
      };
      records.unshift(record);
      return record;
    },
    async listHistory() {
      return records;
    },
    async clearHistory() {
      records.length = 0;
    },
    getImagePath(fileName) {
      return fileName;
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API routes', () => {
  it('returns public config', async () => {
    const app = buildApp({
      config: {
        apiPort: 8787,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        defaultModel: 'gptimage2',
        webOrigin: 'http://localhost:5173',
        imageApiTimeoutMs: 900000,
        maxParallelImageJobs: 5
      },
      provider: {
        generate: async () => [{ url: 'https://cdn.example.com/a.png', b64Json: null }],
        edit: async () => [{ url: 'https://cdn.example.com/b.png', b64Json: null }]
      },
      historyStore: createHistoryStoreStub()
    });

    const response = await app.inject({ method: 'GET', url: '/api/config/public' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      defaultModel: 'gptimage2',
      defaultSize: 'auto',
      defaultQuality: 'medium',
      qualities: ['low', 'medium', 'high'],
      supportsImageEdit: true
    });
    expect(response.json().sizes).toEqual([
      'auto',
      '1024x1024',
      '1536x1024',
      '1024x1536',
      '2048x2048',
      '2048x1152',
      '3840x2160',
      '2160x3840'
    ]);
  });

  it('updates runtime settings and does not expose the full API key', async () => {
    let savedSettings: unknown;
    const app = buildApp({
      config: {
        apiPort: 8787,
        baseUrl: '',
        apiKey: '',
        defaultModel: 'gptimage2',
        webOrigin: 'http://localhost:5173',
        imageApiTimeoutMs: 900000,
        maxParallelImageJobs: 2
      },
      provider: {
        generate: async () => [{ url: 'https://cdn.example.com/a.png', b64Json: null }],
        edit: async () => [{ url: 'https://cdn.example.com/b.png', b64Json: null }]
      },
      historyStore: createHistoryStoreStub(),
      settingsStore: {
        async loadSettings() {
          return {};
        },
        async saveSettings(settings) {
          savedSettings = settings;
        }
      }
    });

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: {
        baseUrl: 'https://api.example.com/v1/images/generations',
        apiKey: 'sk-test-secret',
        maxParallelImageJobs: 4
      }
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      baseUrl: 'https://api.example.com/v1',
      hasApiKey: true,
      maxParallelImageJobs: 4
    });
    expect(JSON.stringify(updated.json())).not.toContain('sk-test-secret');
    expect(savedSettings).toMatchObject({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-secret', maxParallelImageJobs: 4 });

    const jobs = await app.inject({ method: 'GET', url: '/api/jobs' });
    expect(jobs.json().maxParallel).toBe(4);
  });

  it('returns a clear error when provider settings are missing', async () => {
    const app = buildApp({
      config: {
        apiPort: 8787,
        baseUrl: '',
        apiKey: '',
        defaultModel: 'gptimage2',
        webOrigin: 'http://localhost:5173',
        imageApiTimeoutMs: 900000,
        maxParallelImageJobs: 2
      },
      provider: {
        generate: async () => [{ url: 'https://cdn.example.com/a.png', b64Json: null }],
        edit: async () => [{ url: 'https://cdn.example.com/b.png', b64Json: null }]
      },
      historyStore: createHistoryStoreStub()
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/jobs/image/generate',
      payload: { prompt: 'a queued fox', model: 'gptimage2', size: '1024x1024', quality: 'high', n: 1 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('CONFIG_MISSING');
  });

  it('generates images through provider', async () => {
    let receivedRequest: unknown;
    const app = buildApp({
      config: {
        apiPort: 8787,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        defaultModel: 'gptimage2',
        webOrigin: 'http://localhost:5173',
        imageApiTimeoutMs: 900000,
        maxParallelImageJobs: 5
      },
      provider: {
        generate: async (request) => {
          receivedRequest = request;
          return [{ url: 'https://cdn.example.com/a.png', b64Json: null }];
        },
        edit: async () => [{ url: 'https://cdn.example.com/b.png', b64Json: null }]
      },
      historyStore: createHistoryStoreStub()
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/image/generate',
      payload: { prompt: 'a neon fox', model: 'gptimage2', size: '1024x1024', quality: 'high', n: 1 }
    });

    expect(response.statusCode).toBe(200);
    expect(receivedRequest).toMatchObject({ quality: 'high' });
    expect(response.json().images).toEqual([{ url: 'https://cdn.example.com/a.png', b64Json: null }]);
    expect(response.json().history).toMatchObject({ id: 'hist_1', prompt: 'a neon fox', mode: 'text', quality: 'high' });
  });

  it('lists saved image history', async () => {
    const historyStore = createHistoryStoreStub();
    const app = buildApp({
      config: {
        apiPort: 8787,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        defaultModel: 'gptimage2',
        webOrigin: 'http://localhost:5173',
        imageApiTimeoutMs: 900000,
        maxParallelImageJobs: 5
      },
      provider: {
        generate: async () => [{ url: 'https://cdn.example.com/a.png', b64Json: null }],
        edit: async () => [{ url: 'https://cdn.example.com/b.png', b64Json: null }]
      },
      historyStore
    });

    await app.inject({
      method: 'POST',
      url: '/api/image/generate',
      payload: { prompt: 'a neon fox', model: 'gptimage2', size: '1024x1024', n: 1 }
    });
    const response = await app.inject({ method: 'GET', url: '/api/history' });

    expect(response.statusCode).toBe(200);
    expect(response.json().records).toHaveLength(1);
  });

  it('queues image generation jobs without waiting for provider completion', async () => {
    const app = buildApp({
      config: {
        apiPort: 8787,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        defaultModel: 'gptimage2',
        webOrigin: 'http://localhost:5173',
        imageApiTimeoutMs: 900000,
        maxParallelImageJobs: 5
      },
      provider: {
        generate: async () => [{ url: 'https://cdn.example.com/a.png', b64Json: null }],
        edit: async () => [{ url: 'https://cdn.example.com/b.png', b64Json: null }]
      },
      historyStore: createHistoryStoreStub()
    });

    const queued = await app.inject({
      method: 'POST',
      url: '/api/jobs/image/generate',
      payload: { prompt: 'a queued fox', model: 'gptimage2', size: '1024x1024', quality: 'high', n: 1 }
    });

    expect(queued.statusCode).toBe(202);
    expect(queued.json().job).toMatchObject({ prompt: 'a queued fox', quality: 'high' });

    const jobs = await app.inject({ method: 'GET', url: '/api/jobs' });
    expect(jobs.statusCode).toBe(200);
    expect(jobs.json().maxParallel).toBe(5);
    expect(jobs.json().jobs).toHaveLength(1);
  });

  it('retries failed image jobs without resubmitting form data', async () => {
    let attempts = 0;
    const app = buildApp({
      config: {
        apiPort: 8787,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        defaultModel: 'gptimage2',
        webOrigin: 'http://localhost:5173',
        imageApiTimeoutMs: 900000,
        maxParallelImageJobs: 1
      },
      provider: {
        generate: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('transient provider failure');
          }

          return [{ url: 'https://cdn.example.com/a.png', b64Json: null }];
        },
        edit: async () => [{ url: 'https://cdn.example.com/b.png', b64Json: null }]
      },
      historyStore: createHistoryStoreStub()
    });

    const queued = await app.inject({
      method: 'POST',
      url: '/api/jobs/image/generate',
      payload: { prompt: 'retry fox', model: 'gptimage2', size: '1024x1024', quality: 'high', n: 1 }
    });
    const jobId = queued.json().job.id;
    await waitForJobStatus(app, jobId, 'failed');

    const retried = await app.inject({ method: 'POST', url: `/api/jobs/${jobId}/retry` });
    expect(retried.statusCode).toBe(202);
    expect(['queued', 'running']).toContain(retried.json().job.status);

    const finished = await waitForJobStatus(app, jobId, 'succeeded');
    expect(finished.history).toMatchObject({ prompt: 'retry fox' });
    expect(attempts).toBe(2);
  });

  it('cancels queued image jobs without interrupting running jobs', async () => {
    let releaseRunningJob: (() => void) | undefined;
    const runningJob = new Promise<void>((resolve) => {
      releaseRunningJob = resolve;
    });
    const app = buildApp({
      config: {
        apiPort: 8787,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        defaultModel: 'gptimage2',
        webOrigin: 'http://localhost:5173',
        imageApiTimeoutMs: 900000,
        maxParallelImageJobs: 1
      },
      provider: {
        generate: async (request) => {
          if (request.prompt === 'running fox') {
            await runningJob;
          }

          return [{ url: 'https://cdn.example.com/a.png', b64Json: null }];
        },
        edit: async () => [{ url: 'https://cdn.example.com/b.png', b64Json: null }]
      },
      historyStore: createHistoryStoreStub()
    });

    const running = await app.inject({
      method: 'POST',
      url: '/api/jobs/image/generate',
      payload: { prompt: 'running fox', model: 'gptimage2', size: '1024x1024', quality: 'high', n: 1 }
    });
    const queued = await app.inject({
      method: 'POST',
      url: '/api/jobs/image/generate',
      payload: { prompt: 'queued fox', model: 'gptimage2', size: '1024x1024', quality: 'high', n: 1 }
    });

    expect(running.json().job.status).toBe('running');
    expect(queued.json().job.status).toBe('queued');

    const canceled = await app.inject({ method: 'POST', url: `/api/jobs/${queued.json().job.id}/cancel` });
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json().job).toMatchObject({ status: 'canceled', prompt: 'queued fox' });

    const jobs = await app.inject({ method: 'GET', url: '/api/jobs' });
    expect(jobs.json().queuedCount).toBe(0);

    releaseRunningJob?.();
    const finished = await waitForJobStatus(app, running.json().job.id, 'succeeded');
    expect(finished.prompt).toBe('running fox');
  });

  it('normalizes validation errors', async () => {
    const app = buildApp({
      config: {
        apiPort: 8787,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        defaultModel: 'gptimage2',
        webOrigin: 'http://localhost:5173',
        imageApiTimeoutMs: 900000,
        maxParallelImageJobs: 5
      },
      provider: {
        generate: async () => [{ url: 'https://cdn.example.com/a.png', b64Json: null }],
        edit: async () => [{ url: 'https://cdn.example.com/b.png', b64Json: null }]
      },
      historyStore: createHistoryStoreStub()
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/image/generate',
      payload: { prompt: '', model: 'gptimage2', size: '1024x1024', n: 1 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('passes multiple uploaded images to the edit provider', async () => {
    let receivedImageCount = 0;
    let receivedFields: unknown;
    const app = buildApp({
      config: {
        apiPort: 8787,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        defaultModel: 'gptimage2',
        webOrigin: 'http://localhost:5173',
        imageApiTimeoutMs: 900000,
        maxParallelImageJobs: 5
      },
      provider: {
        generate: async () => [{ url: 'https://cdn.example.com/a.png', b64Json: null }],
        edit: async (fields, images) => {
          receivedFields = fields;
          receivedImageCount = images.length;
          return [{ url: 'https://cdn.example.com/b.png', b64Json: null }];
        }
      },
      historyStore: createHistoryStoreStub()
    });

    const form = new FormData();
    form.set('prompt', 'combine these references');
    form.set('model', 'gpt-image-2');
    form.set('size', '1024x1024');
    form.set('quality', 'low');
    form.append('image', new Blob([new Uint8Array([1])], { type: 'image/png' }), 'first.png');
    form.append('image', new Blob([new Uint8Array([2])], { type: 'image/png' }), 'second.png');

    const response = await app.inject({
      method: 'POST',
      url: '/api/image/edit',
      payload: form,
      headers: form instanceof FormData ? {} : undefined
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toMatch(/^edit-/);
    expect(receivedImageCount).toBe(2);
    expect(receivedFields).toMatchObject({ quality: 'low' });
    expect(response.json().history).toMatchObject({ mode: 'image', prompt: 'combine these references', quality: 'low' });
  });

  it('downloads a remote image as an attachment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        })
      )
    );

    const app = buildApp({
      config: {
        apiPort: 8787,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        defaultModel: 'gptimage2',
        webOrigin: 'http://localhost:5173',
        imageApiTimeoutMs: 900000,
        maxParallelImageJobs: 5
      },
      provider: {
        generate: async () => [{ url: 'https://cdn.example.com/a.png', b64Json: null }],
        edit: async () => [{ url: 'https://cdn.example.com/b.png', b64Json: null }]
      },
      historyStore: createHistoryStoreStub()
    });

    const response = await app.inject({ method: 'GET', url: '/api/image/download?url=https%3A%2F%2Fcdn.example.com%2Fa.png' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment; filename="generated-image.png"');
    expect(response.headers['content-type']).toContain('image/png');
  });

  it('rejects unsafe download URLs', async () => {
    const app = buildApp({
      config: {
        apiPort: 8787,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        defaultModel: 'gptimage2',
        webOrigin: 'http://localhost:5173',
        imageApiTimeoutMs: 900000,
        maxParallelImageJobs: 5
      },
      provider: {
        generate: async () => [{ url: 'https://cdn.example.com/a.png', b64Json: null }],
        edit: async () => [{ url: 'https://cdn.example.com/b.png', b64Json: null }]
      },
      historyStore: createHistoryStoreStub()
    });

    const response = await app.inject({ method: 'GET', url: '/api/image/download?url=file%3A%2F%2F%2Fetc%2Fpasswd' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns JSON instead of dropping the connection for oversized uploads', async () => {
    const app = buildApp({
      config: {
        apiPort: 8787,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        defaultModel: 'gptimage2',
        webOrigin: 'http://localhost:5173',
        imageApiTimeoutMs: 900000,
        maxParallelImageJobs: 5
      },
      provider: {
        generate: async () => [{ url: 'https://cdn.example.com/a.png', b64Json: null }],
        edit: async () => [{ url: 'https://cdn.example.com/b.png', b64Json: null }]
      },
      historyStore: createHistoryStoreStub()
    });

    const form = new FormData();
    form.set('prompt', 'large image');
    form.set('model', 'gpt-image-2');
    form.set('size', '1024x1024');
    form.append('image', new Blob([new Uint8Array(65 * 1024 * 1024)], { type: 'image/png' }), 'huge.png');

    const response = await app.inject({ method: 'POST', url: '/api/image/edit', payload: form });

    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

async function waitForJobStatus(app: ReturnType<typeof buildApp>, jobId: string, status: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await app.inject({ method: 'GET', url: `/api/jobs/${jobId}` });
    const job = response.json().job;
    if (job.status === status) {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`Job ${jobId} did not reach ${status}`);
}
