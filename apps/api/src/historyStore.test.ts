import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistoryStore } from './historyStore';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'image-history-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tempDir, { recursive: true, force: true });
});

describe('createHistoryStore', () => {
  it('saves base64 images and appends a history record', async () => {
    const store = createHistoryStore({ dataDir: tempDir, publicBaseUrl: 'http://localhost:8700' });
    const record = await store.saveGeneration({
      mode: 'text',
      prompt: 'a fox',
      model: 'gpt-image-2',
      size: '1024x1024',
      quality: 'high',
      durationMs: 10,
      images: [{ url: null, b64Json: Buffer.from('png').toString('base64') }]
    });

    expect(record.quality).toBe('high');
    expect(record.images[0].fileName).toMatch(/\.png$/);
    expect(record.images[0].url).toContain('/api/history/image/');
    await expect(stat(join(tempDir, 'generated', record.images[0].fileName))).resolves.toBeTruthy();
    expect(await store.listHistory()).toHaveLength(1);
  });

  it('saves URL images using the remote content type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }))
    );
    const store = createHistoryStore({ dataDir: tempDir, publicBaseUrl: 'http://localhost:8700' });

    const record = await store.saveGeneration({
      mode: 'image',
      prompt: 'edit fox',
      model: 'gpt-image-2',
      size: '1024x1536',
      durationMs: 20,
      images: [{ url: 'https://cdn.example.com/image.jpg', b64Json: null }]
    });

    expect(record.images[0]).toMatchObject({ mimeType: 'image/jpeg', bytes: 3, sourceUrl: 'https://cdn.example.com/image.jpg' });
    expect(record.images[0].fileName).toMatch(/\.jpg$/);
  });

  it('clears saved history and generated images', async () => {
    const store = createHistoryStore({ dataDir: tempDir, publicBaseUrl: 'http://localhost:8700' });
    await store.saveGeneration({
      mode: 'text',
      prompt: 'a fox',
      model: 'gpt-image-2',
      size: '1024x1024',
      durationMs: 10,
      images: [{ url: null, b64Json: Buffer.from('png').toString('base64') }]
    });

    await store.clearHistory();

    expect(await store.listHistory()).toEqual([]);
    expect(JSON.parse(await readFile(join(tempDir, 'history.json'), 'utf8'))).toEqual([]);
  });
});
