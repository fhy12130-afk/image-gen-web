import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProviderUrl, editOpenAIImage, generateOpenAIImage, normalizeOpenAIImageResponse } from './openaiImageProvider';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildProviderUrl', () => {
  it('joins base URL and path without duplicate slashes', () => {
    expect(buildProviderUrl('https://api.example.com/v1/', '/images/generations')).toBe(
      'https://api.example.com/v1/images/generations'
    );
  });
});

describe('normalizeOpenAIImageResponse', () => {
  it('normalizes url image responses', () => {
    expect(normalizeOpenAIImageResponse({ data: [{ url: 'https://cdn.example.com/a.png' }] })).toEqual([
      { url: 'https://cdn.example.com/a.png', b64Json: null }
    ]);
  });

  it('normalizes base64 image responses', () => {
    expect(normalizeOpenAIImageResponse({ data: [{ b64_json: 'abc123' }] })).toEqual([
      { url: null, b64Json: 'abc123' }
    ]);
  });

  it('rejects unsupported responses', () => {
    expect(() => normalizeOpenAIImageResponse({ data: [{}] })).toThrow('Unsupported image provider response');
  });
});

describe('editOpenAIImage', () => {
  it('sends quality in generation request bodies', async () => {
    const sentBodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/a.png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );

    await generateOpenAIImage(
      { baseUrl: 'https://api.example.com/v1', apiKey: 'secret', timeoutMs: 900000 },
      { prompt: 'a fox', model: 'gpt-image-2', size: '1024x1024', quality: 'high', n: 1 }
    );

    expect(sentBodies[0]).toMatchObject({ quality: 'high' });
  });

  it('sends multiple images using repeated image fields', async () => {
    const sentForms: FormData[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentForms.push(init?.body as FormData);
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/a.png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );

    await editOpenAIImage(
      { baseUrl: 'https://api.example.com/v1', apiKey: 'secret', timeoutMs: 900000 },
      { prompt: 'combine references', model: 'gpt-image-2', size: '1024x1024', quality: 'medium' },
      [
        { buffer: Buffer.from([1]), filename: 'first.png', mimetype: 'image/png' },
        { buffer: Buffer.from([2]), filename: 'second.png', mimetype: 'image/png' }
      ]
    );

    expect(sentForms[0].getAll('image')).toHaveLength(2);
    expect(sentForms[0].get('quality')).toBe('medium');
  });

  it('includes provider error body when edit request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'Only one image is supported' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );

    await expect(
      editOpenAIImage(
        { baseUrl: 'https://api.example.com/v1', apiKey: 'secret', timeoutMs: 900000 },
        { prompt: 'combine references', model: 'gpt-image-2', size: '1024x1024', quality: 'medium' },
        [{ buffer: Buffer.from([1]), filename: 'first.png', mimetype: 'image/png' }]
      )
    ).rejects.toThrow('Only one image is supported');
  });

  it('retries transient network failures before returning images', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/a.png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const images = await generateOpenAIImage(
      { baseUrl: 'https://api.example.com/v1', apiKey: 'secret', timeoutMs: 900000, maxRetries: 1, retryDelayMs: 0 },
      { prompt: 'a fox', model: 'gpt-image-2', size: '1024x1024', quality: 'high', n: 1 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(images[0].url).toBe('https://cdn.example.com/a.png');
  });

  it('retries retryable provider status errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'stream error' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/a.png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await editOpenAIImage(
      { baseUrl: 'https://api.example.com/v1', apiKey: 'secret', timeoutMs: 900000, maxRetries: 1, retryDelayMs: 0 },
      { prompt: 'combine references', model: 'gpt-image-2', size: '1024x1024', quality: 'medium' },
      [{ buffer: Buffer.from([1]), filename: 'first.png', mimetype: 'image/png' }]
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports timeout when edit request is aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
        return new Response('{}');
      })
    );

    await expect(
      editOpenAIImage(
        { baseUrl: 'https://api.example.com/v1', apiKey: 'secret', timeoutMs: 1 },
        { prompt: 'combine references', model: 'gpt-image-2', size: '1024x1024', quality: 'medium' },
        [{ buffer: Buffer.from([1]), filename: 'first.png', mimetype: 'image/png' }]
      )
    ).rejects.toThrow('Provider request timed out after 1 ms');
  });
});
