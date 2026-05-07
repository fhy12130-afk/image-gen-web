import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { GeneratedImage, ImageHistoryRecord, ImageQuality } from '@image-gen-web/shared';

type HistoryStoreOptions = {
  dataDir: string;
  publicBaseUrl: string;
};

type SaveGenerationInput = {
  clientId?: string;
  mode: 'text' | 'image';
  prompt: string;
  model: string;
  size: string;
  quality?: ImageQuality;
  durationMs: number;
  images: GeneratedImage[];
};

export type HistoryStore = ReturnType<typeof createHistoryStore>;

export function createHistoryStore(options: HistoryStoreOptions) {
  const generatedDir = join(options.dataDir, 'generated');
  const historyPath = join(options.dataDir, 'history.json');

  async function ensureDataDir() {
    await mkdir(generatedDir, { recursive: true });
  }

  async function readHistory(): Promise<ImageHistoryRecord[]> {
    try {
      const raw = await readFile(historyPath, 'utf8');
      return JSON.parse(raw) as ImageHistoryRecord[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async function writeHistory(records: ImageHistoryRecord[]) {
    await ensureDataDir();
    await writeFile(historyPath, JSON.stringify(records, null, 2));
  }

  function imageUrl(fileName: string) {
    return `${options.publicBaseUrl}/api/history/image/${encodeURIComponent(fileName)}`;
  }

  async function saveProviderImage(image: GeneratedImage) {
    const id = `img_${randomUUID().replaceAll('-', '')}`;
    let bytes: Buffer;
    let mimeType = 'image/png';
    let extension = 'png';
    let sourceUrl: string | undefined;

    if (image.b64Json) {
      bytes = Buffer.from(image.b64Json, 'base64');
    } else if (image.url) {
      sourceUrl = image.url;
      const response = await fetch(image.url);
      if (!response.ok) {
        throw new Error(`Failed to save provider image: ${response.status} ${response.statusText}`);
      }
      mimeType = response.headers.get('content-type') || mimeType;
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      throw new Error('Generated image does not include a URL or base64 payload.');
    }

    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
      extension = 'jpg';
    } else if (mimeType.includes('webp')) {
      extension = 'webp';
    }

    const fileName = `${id}.${extension}`;
    await ensureDataDir();
    await writeFile(join(generatedDir, fileName), bytes);

    return {
      id,
      fileName,
      mimeType,
      bytes: bytes.byteLength,
      url: imageUrl(fileName),
      downloadUrl: `${imageUrl(fileName)}?download=1`,
      sourceUrl
    };
  }

  return {
    async saveGeneration(input: SaveGenerationInput): Promise<ImageHistoryRecord> {
      const savedImages = await Promise.all(input.images.map((image) => saveProviderImage(image)));
      const record: ImageHistoryRecord = {
        id: `hist_${randomUUID().replaceAll('-', '')}`,
        createdAt: new Date().toISOString(),
        clientId: input.clientId,
        mode: input.mode,
        prompt: input.prompt,
        model: input.model,
        size: input.size,
        quality: input.quality,
        durationMs: input.durationMs,
        images: savedImages
      };
      const records = await readHistory();
      await writeHistory([record, ...records]);
      return record;
    },

    async listHistory(clientId?: string): Promise<ImageHistoryRecord[]> {
      const records = await readHistory();
      return clientId ? records.filter((record) => record.clientId === clientId) : records;
    },

    async clearHistory(clientId?: string): Promise<void> {
      await ensureDataDir();
      if (clientId) {
        const records = await readHistory();
        const removedRecords = records.filter((record) => record.clientId === clientId);
        const retainedRecords = records.filter((record) => record.clientId !== clientId);
        await Promise.all(removedRecords.flatMap((record) => record.images.map((image) => rm(join(generatedDir, image.fileName), { force: true }))));
        await writeHistory(retainedRecords);
        return;
      }

      const files = await readdir(generatedDir).catch(() => []);
      await Promise.all(files.map((file) => rm(join(generatedDir, file), { force: true })));
      await writeHistory([]);
    },

    getImagePath(fileName: string): string {
      return join(generatedDir, basename(fileName));
    }
  };
}
