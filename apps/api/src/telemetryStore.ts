import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type TelemetryEvent = {
  id: string;
  time: string;
  type: string;
  level: 'info' | 'error';
  requestId?: string;
  jobId?: string;
  clientId?: string;
  method?: string;
  url?: string;
  statusCode?: number;
  status?: string;
  mode?: string;
  model?: string;
  size?: string;
  quality?: string;
  providerBaseUrl?: string;
  durationMs?: number;
  prompt?: string;
  error?: string;
  requestBody?: unknown;
  upstreamRequest?: unknown;
  upstreamResponse?: unknown;
  details?: unknown;
};

export type TelemetryStore = ReturnType<typeof createTelemetryStore>;

const MAX_READ_BYTES = 8 * 1024 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const STORED_EVENT_TYPES = new Set(['image.request', 'image.success', 'image.failure']);
let lastCleanupAt = 0;

export function createTelemetryStore(filePath: string) {
  async function appendLine(line: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${line}\n`, { flag: 'a' });
  }

  async function readEvents(): Promise<TelemetryEvent[]> {
    try {
      const raw = await readFile(filePath, 'utf8');
      const tail = raw.length > MAX_READ_BYTES ? raw.slice(raw.length - MAX_READ_BYTES) : raw;
      return tail
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as TelemetryEvent;
          } catch {
            return null;
          }
        })
        .filter((event): event is TelemetryEvent => Boolean(event))
        .filter((event) => STORED_EVENT_TYPES.has(event.type))
        .sort((left, right) => Date.parse(right.time) - Date.parse(left.time));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async function cleanupExpired(): Promise<void> {
    const now = Date.now();
    if (now - lastCleanupAt < 60 * 60 * 1000) {
      return;
    }
    lastCleanupAt = now;

    const events = await readEvents();
    const retainedEvents = events
      .filter((event) => Date.parse(event.time) >= now - RETENTION_MS)
      .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, retainedEvents.map((event) => JSON.stringify(event)).join('\n') + (retainedEvents.length ? '\n' : ''));
  }

  return {
    async record(input: Omit<TelemetryEvent, 'id' | 'time'> & { time?: string }): Promise<void> {
      if (!STORED_EVENT_TYPES.has(input.type)) {
        return;
      }

      await cleanupExpired();
      const event: TelemetryEvent = {
        id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        time: input.time || new Date().toISOString(),
        ...input,
        prompt: input.prompt ? input.prompt.slice(0, 500) : undefined,
        error: input.error ? input.error.slice(0, 1000) : undefined,
        requestBody: sanitizeForTelemetry(input.requestBody),
        upstreamRequest: sanitizeForTelemetry(input.upstreamRequest),
        upstreamResponse: sanitizeForTelemetry(input.upstreamResponse),
        details: sanitizeForTelemetry(input.details)
      };
      await appendLine(JSON.stringify(event));
    },

    async list(options: { limit?: number; sinceMs?: number; level?: 'info' | 'error'; type?: string } = {}): Promise<TelemetryEvent[]> {
      const sinceTime = options.sinceMs ? Date.now() - options.sinceMs : null;
      const events = await readEvents();
      return events
        .filter((event) => Date.parse(event.time) >= Date.now() - RETENTION_MS)
        .filter((event) => (sinceTime ? Date.parse(event.time) >= sinceTime : true))
        .filter((event) => (options.level ? event.level === options.level : true))
        .filter((event) => (options.type ? event.type === options.type : true))
        .slice(0, options.limit || 500);
    },

    async summary(): Promise<{
      windows: Record<'24h' | '7d' | '30d', { requests: number; jobs: number; failures: number; success: number }>;
      recentErrors: TelemetryEvent[];
    }> {
      const events = await readEvents();
      const windows = {
        '24h': summarizeWindow(events, 24 * 60 * 60 * 1000),
        '7d': summarizeWindow(events, 7 * 24 * 60 * 60 * 1000),
        '30d': summarizeWindow(events, 30 * 24 * 60 * 60 * 1000)
      };

      return {
        windows,
        recentErrors: events.filter((event) => event.level === 'error').slice(0, 30)
      };
    }
  };
}

function summarizeWindow(events: TelemetryEvent[], windowMs: number) {
  const since = Date.now() - windowMs;
  const scoped = events.filter((event) => Date.parse(event.time) >= since);
  return {
    requests: scoped.filter((event) => event.type === 'image.request').length,
    jobs: scoped.filter((event) => event.type === 'image.request').length,
    failures: scoped.filter((event) => event.type === 'image.failure').length,
    success: scoped.filter((event) => event.type === 'image.success').length
  };
}

function sanitizeForTelemetry(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === 'string') {
    return truncate(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeForTelemetry(item));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/authorization|api[-_]?key|token|secret|password/i.test(key)) {
      output[key] = '<redacted>';
      continue;
    }
    output[key] = sanitizeForTelemetry(item);
  }
  return output;
}

function truncate(value: string): string {
  return value.length > 2000 ? `${value.slice(0, 2000)}...[truncated]` : value;
}
