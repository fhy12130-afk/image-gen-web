import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_IMAGE_SIZE,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  imageGenerationRequestSchema,
  imageJobRecordSchema,
  imageJobsResponseSchema,
  imageHistoryRecordSchema,
  imageResponseSchema,
  apiSettingsResponseSchema,
  apiSettingsUpdateSchema,
  publicConfigSchema
} from './contracts';

describe('imageGenerationRequestSchema', () => {
  it('accepts a minimal valid generation request', () => {
    const result = imageGenerationRequestSchema.parse({
      prompt: 'a neon fox',
      model: 'gptimage2',
      size: '1024x1024',
      n: 1
    });

    expect(result.prompt).toBe('a neon fox');
  });

  it('rejects an empty prompt', () => {
    expect(() =>
      imageGenerationRequestSchema.parse({
        prompt: '',
        model: 'gptimage2',
        size: '1024x1024',
        n: 1
      })
    ).toThrow();
  });

  it('accepts auto size for flexible image models', () => {
    const result = imageGenerationRequestSchema.parse({
      prompt: 'a neon fox',
      model: 'gpt-image-2',
      size: 'auto',
      n: 1
    });

    expect(result.size).toBe('auto');
  });

  it('accepts custom WIDTHxHEIGHT sizes', () => {
    const result = imageGenerationRequestSchema.parse({
      prompt: 'a neon fox',
      model: 'gpt-image-2',
      size: '1280x720',
      n: 1
    });

    expect(result.size).toBe('1280x720');
  });

  it('defaults quality when it is omitted', () => {
    const result = imageGenerationRequestSchema.parse({
      prompt: 'a neon fox',
      model: 'gpt-image-2',
      size: '1024x1024',
      n: 1
    });

    expect(result.quality).toBe(DEFAULT_IMAGE_QUALITY);
  });

  it('accepts explicit image quality values', () => {
    const result = imageGenerationRequestSchema.parse({
      prompt: 'a neon fox',
      model: 'gpt-image-2',
      size: '1024x1024',
      quality: 'high',
      n: 1
    });

    expect(result.quality).toBe('high');
  });

  it('rejects malformed sizes', () => {
    expect(() =>
      imageGenerationRequestSchema.parse({
        prompt: 'a neon fox',
        model: 'gpt-image-2',
        size: 'wide',
        n: 1
      })
    ).toThrow();
  });

  it('rejects custom sizes outside image2 limits', () => {
    expect(() =>
      imageGenerationRequestSchema.parse({
        prompt: 'a neon fox',
        model: 'gpt-image-2',
        size: '4000x4000',
        n: 1
      })
    ).toThrow();
  });
});

describe('publicConfigSchema', () => {
  it('accepts public image defaults and options', () => {
    const parsed = publicConfigSchema.parse({
      defaultModel: 'gptimage2',
      defaultSize: DEFAULT_IMAGE_SIZE,
      sizes: [...IMAGE_SIZE_OPTIONS],
      defaultQuality: DEFAULT_IMAGE_QUALITY,
      qualities: [...IMAGE_QUALITY_OPTIONS],
      maxParallelImageJobs: 5,
      supportsImageEdit: true
    });

    expect(parsed.sizes).toContain('3840x2160');
    expect(parsed.qualities).toEqual(['low', 'medium', 'high']);
    expect(parsed.maxParallelImageJobs).toBe(5);
  });

  it('requires at least one output size', () => {
    expect(() =>
      publicConfigSchema.parse({
        defaultModel: 'gptimage2',
        defaultSize: DEFAULT_IMAGE_SIZE,
        sizes: [],
        defaultQuality: DEFAULT_IMAGE_QUALITY,
        qualities: [...IMAGE_QUALITY_OPTIONS],
        maxParallelImageJobs: 5,
        supportsImageEdit: true
      })
    ).toThrow();
  });
});

describe('apiSettingsSchema', () => {
  it('accepts runtime settings responses without exposing the full API key', () => {
    const parsed = apiSettingsResponseSchema.parse({
      baseUrl: 'https://api.example.com/v1',
      defaultModel: 'gpt-image-2',
      maxParallelImageJobs: 4,
      hasApiKey: true,
      apiKeyPreview: 'sk-abc...xyz'
    });

    expect(parsed.hasApiKey).toBe(true);
  });

  it('accepts partial runtime settings updates', () => {
    const parsed = apiSettingsUpdateSchema.parse({
      baseUrl: 'https://api.example.com/v1/images/generations',
      apiKey: 'secret',
      maxParallelImageJobs: 6
    });

    expect(parsed.maxParallelImageJobs).toBe(6);
  });
});

describe('imageHistoryRecordSchema', () => {
  it('accepts image history records', () => {
    const parsed = imageHistoryRecordSchema.parse({
      id: 'hist_abc',
      createdAt: '2026-04-29T00:00:00.000Z',
      mode: 'text',
      prompt: 'a fox',
      model: 'gpt-image-2',
      size: '1024x1024',
      quality: 'medium',
      durationMs: 123,
      images: [
        {
          id: 'img_abc',
          fileName: 'img_abc.png',
          mimeType: 'image/png',
          bytes: 12,
          url: '/api/history/image/img_abc.png',
          downloadUrl: '/api/history/image/img_abc.png?download=1'
        }
      ]
    });

    expect(parsed.id).toBe('hist_abc');
  });

  it('allows image responses to include saved history metadata', () => {
    const parsed = imageResponseSchema.parse({
      durationMs: 123,
      images: [{ url: 'https://cdn.example.com/image.png', b64Json: null }],
      history: {
        id: 'hist_abc',
        createdAt: '2026-04-29T00:00:00.000Z',
        mode: 'text',
        prompt: 'a fox',
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'medium',
        durationMs: 123,
        images: [
          {
            id: 'img_abc',
            fileName: 'img_abc.png',
            mimeType: 'image/png',
            bytes: 12,
            url: '/api/history/image/img_abc.png',
            downloadUrl: '/api/history/image/img_abc.png?download=1'
          }
        ]
      }
    });

    expect(parsed.history?.images[0].downloadUrl).toBe('/api/history/image/img_abc.png?download=1');
  });
});

describe('imageJobRecordSchema', () => {
  it('accepts queued image jobs and succeeded jobs with history', () => {
    const queued = imageJobRecordSchema.parse({
      id: 'job_abc',
      createdAt: '2026-04-29T00:00:00.000Z',
      updatedAt: '2026-04-29T00:00:00.000Z',
      status: 'queued',
      mode: 'text',
      prompt: 'a fox',
      model: 'gpt-image-2',
      size: '2048x2048',
      quality: 'high',
      imageCount: 0
    });

    expect(queued.status).toBe('queued');

    const response = imageJobsResponseSchema.parse({
      jobs: [
        {
          ...queued,
          status: 'succeeded',
          finishedAt: '2026-04-29T00:01:00.000Z',
          durationMs: 60000,
          history: {
            id: 'hist_abc',
            createdAt: '2026-04-29T00:01:00.000Z',
            mode: 'text',
            prompt: 'a fox',
            model: 'gpt-image-2',
            size: '2048x2048',
            quality: 'high',
            durationMs: 60000,
            images: [
              {
                id: 'img_abc',
                fileName: 'img_abc.png',
                mimeType: 'image/png',
                bytes: 12,
                url: '/api/history/image/img_abc.png',
                downloadUrl: '/api/history/image/img_abc.png?download=1'
              }
            ]
          }
        }
      ],
      maxParallel: 5,
      runningCount: 0,
      queuedCount: 0
    });

    expect(response.maxParallel).toBe(5);
  });

  it('accepts canceled image jobs', () => {
    const parsed = imageJobRecordSchema.parse({
      id: 'job_canceled',
      createdAt: '2026-04-29T00:00:00.000Z',
      updatedAt: '2026-04-29T00:00:10.000Z',
      status: 'canceled',
      mode: 'text',
      prompt: 'a fox',
      model: 'gpt-image-2',
      size: '2048x2048',
      quality: 'high',
      imageCount: 0,
      finishedAt: '2026-04-29T00:00:10.000Z'
    });

    expect(parsed.status).toBe('canceled');
  });
});
