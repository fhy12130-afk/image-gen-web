import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelImageJobTool,
  editImageTool,
  generateImageTool,
  getApiUrl,
  getImageHistoryItemTool,
  getImageJobTool,
  listImageHistoryTool,
  listImageJobsTool,
  queueImageEditTool,
  queueImageGenerationTool,
  retryImageJobTool
} from './server';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'image-mcp-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tempDir, { recursive: true, force: true });
});

describe('getApiUrl', () => {
  it('uses the default local API URL', () => {
    expect(getApiUrl({})).toBe('http://localhost:8700');
  });

  it('normalizes configured API URLs', () => {
    expect(getApiUrl({ IMAGE_GEN_API_URL: 'http://127.0.0.1:9000/' })).toBe('http://127.0.0.1:9000');
  });
});

describe('MCP tool handlers', () => {
  it('posts generate requests with quality and formats saved image metadata', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/config/public')) {
        return jsonResponse({
          defaultModel: 'gpt-image-2',
          defaultSize: 'auto',
          sizes: ['auto', '2048x2048'],
          defaultQuality: 'medium',
          qualities: ['low', 'medium', 'high'],
          maxParallelImageJobs: 5,
          supportsImageEdit: true
        });
      }

      expect(String(input)).toBe('http://api.test/api/image/generate');
      expect(JSON.parse(String(init?.body))).toMatchObject({ prompt: 'studio render', size: '2048x2048', quality: 'high' });
      return jsonResponse({
        durationMs: 42,
        images: [{ url: 'https://cdn.example.com/a.png', b64Json: null }],
        history: historyRecord()
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateImageTool({ prompt: 'studio render', size: '2048x2048', quality: 'high' }, 'http://api.test');
    const payload = JSON.parse(result.content[0].text);

    expect(payload.historyId).toBe('hist_1');
    expect(payload.images[0].downloadUrl).toContain('/api/history/image/img_1.png?download=1');
  });

  it('posts edit requests with local image files', async () => {
    const referencePath = join(tempDir, 'reference.png');
    await writeFile(referencePath, Buffer.from([1, 2, 3]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/config/public')) {
        return jsonResponse({
          defaultModel: 'gpt-image-2',
          defaultSize: 'auto',
          sizes: ['auto', '1024x1024'],
          defaultQuality: 'medium',
          qualities: ['low', 'medium', 'high'],
          maxParallelImageJobs: 5,
          supportsImageEdit: true
        });
      }

      expect(String(input)).toBe('http://api.test/api/image/edit');
      const form = init?.body as FormData;
      expect(form.get('quality')).toBe('low');
      expect(form.getAll('image')).toHaveLength(1);
      return jsonResponse({
        durationMs: 42,
        images: [{ url: 'https://cdn.example.com/a.png', b64Json: null }],
        history: historyRecord()
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await editImageTool({ prompt: 'clean background', imagePaths: [referencePath], quality: 'low' }, 'http://api.test');
    const payload = JSON.parse(result.content[0].text);

    expect(payload.action).toBe('edited');
    expect(payload.historyId).toBe('hist_1');
  });

  it('lists and fetches history records', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          records: [historyRecord(), { ...historyRecord(), id: 'hist_2', prompt: 'second' }]
        })
      )
    );

    const listResult = await listImageHistoryTool({ limit: 1 }, 'http://api.test');
    expect(JSON.parse(listResult.content[0].text).records).toHaveLength(1);

    const itemResult = await getImageHistoryItemTool({ historyId: 'hist_2' }, 'http://api.test');
    expect(JSON.parse(itemResult.content[0].text).prompt).toBe('second');
  });

  it('queues image generation jobs without waiting for completion', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/config/public')) {
        return jsonResponse({
          defaultModel: 'gpt-image-2',
          defaultSize: 'auto',
          sizes: ['auto', '3840x2160'],
          defaultQuality: 'medium',
          qualities: ['low', 'medium', 'high'],
          maxParallelImageJobs: 5,
          supportsImageEdit: true
        });
      }

      expect(String(input)).toBe('http://api.test/api/jobs/image/generate');
      expect(JSON.parse(String(init?.body))).toMatchObject({ prompt: 'parallel render', size: '3840x2160', quality: 'high' });
      return jsonResponse({ job: imageJobRecord({ prompt: 'parallel render', status: 'queued' }) }, 202);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await queueImageGenerationTool({ prompt: 'parallel render', size: '3840x2160', quality: 'high' }, 'http://api.test');
    const payload = JSON.parse(result.content[0].text);

    expect(payload.queued).toBe(true);
    expect(payload.maxParallelImageJobs).toBe(5);
    expect(payload.job).toMatchObject({ id: 'job_1', status: 'queued', prompt: 'parallel render' });
  });

  it('queues image edit jobs with local image files', async () => {
    const referencePath = join(tempDir, 'reference.png');
    await writeFile(referencePath, Buffer.from([1, 2, 3]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/config/public')) {
        return jsonResponse({
          defaultModel: 'gpt-image-2',
          defaultSize: 'auto',
          sizes: ['auto', '1024x1024'],
          defaultQuality: 'medium',
          qualities: ['low', 'medium', 'high'],
          maxParallelImageJobs: 5,
          supportsImageEdit: true
        });
      }

      expect(String(input)).toBe('http://api.test/api/jobs/image/edit');
      const form = init?.body as FormData;
      expect(form.getAll('image')).toHaveLength(1);
      return jsonResponse({ job: imageJobRecord({ mode: 'image', prompt: 'queue edit', imageCount: 1 }) }, 202);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await queueImageEditTool({ prompt: 'queue edit', imagePaths: [referencePath] }, 'http://api.test');
    const payload = JSON.parse(result.content[0].text);

    expect(payload.job).toMatchObject({ mode: 'image', imageCount: 1, prompt: 'queue edit' });
  });

  it('lists and fetches image jobs', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/jobs/job_1')) {
        return jsonResponse({ job: imageJobRecord({ status: 'succeeded', history: historyRecord() }) });
      }

      return jsonResponse({
        jobs: [imageJobRecord({ status: 'running' }), imageJobRecord({ status: 'queued', id: 'job_2' })],
        maxParallel: 5,
        runningCount: 1,
        queuedCount: 1
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const listResult = await listImageJobsTool('http://api.test');
    const listPayload = JSON.parse(listResult.content[0].text);
    expect(listPayload.jobs).toHaveLength(2);
    expect(listPayload.maxParallel).toBe(5);

    const itemResult = await getImageJobTool({ jobId: 'job_1' }, 'http://api.test');
    expect(JSON.parse(itemResult.content[0].text)).toMatchObject({ status: 'succeeded', history: { id: 'hist_1' } });
  });

  it('retries failed image jobs', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://api.test/api/jobs/job_1/retry');
      expect(init?.method).toBe('POST');
      return jsonResponse({ job: imageJobRecord({ status: 'queued' }) }, 202);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await retryImageJobTool({ jobId: 'job_1' }, 'http://api.test');

    expect(JSON.parse(result.content[0].text)).toMatchObject({ id: 'job_1', status: 'queued' });
  });

  it('cancels queued image jobs', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://api.test/api/jobs/job_1/cancel');
      expect(init?.method).toBe('POST');
      return jsonResponse({ job: imageJobRecord({ status: 'canceled' }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await cancelImageJobTool({ jobId: 'job_1' }, 'http://api.test');

    expect(JSON.parse(result.content[0].text)).toMatchObject({ id: 'job_1', status: 'canceled' });
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function historyRecord() {
  return {
    id: 'hist_1',
    createdAt: '2026-04-29T00:00:00.000Z',
    mode: 'text',
    prompt: 'studio render',
    model: 'gpt-image-2',
    size: '2048x2048',
    quality: 'high',
    durationMs: 42,
    images: [
      {
        id: 'img_1',
        fileName: 'img_1.png',
        mimeType: 'image/png',
        bytes: 3,
        url: 'http://localhost:8700/api/history/image/img_1.png',
        downloadUrl: 'http://localhost:8700/api/history/image/img_1.png?download=1'
      }
    ]
  };
}

function imageJobRecord(overrides: Record<string, unknown> = {}) {
  return {
    ...baseImageJobRecord(),
    ...overrides
  };
}

function baseImageJobRecord() {
  return {
    id: 'job_1',
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
    status: 'queued',
    mode: 'text',
    prompt: 'studio render',
    model: 'gpt-image-2',
    size: '2048x2048',
    quality: 'high',
    imageCount: 0
  };
}
