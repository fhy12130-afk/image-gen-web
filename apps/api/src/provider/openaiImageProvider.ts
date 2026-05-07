import type { GeneratedImage, ImageEditFields, ImageGenerationRequest } from '@image-gen-web/shared';
import { logDiagnostic } from '../diagnostics.js';

type ProviderTelemetryCapture = {
  upstreamRequest?: unknown;
  upstreamResponse?: unknown;
};

type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
  telemetry?: ProviderTelemetryCapture;
};

const DEFAULT_PROVIDER_MAX_RETRIES = 2;
const DEFAULT_PROVIDER_RETRY_DELAY_MS = 8000;

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function buildProviderUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function normalizeOpenAIImageResponse(payload: unknown): GeneratedImage[] {
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    throw new Error('Unsupported image provider response');
  }

  const data = (payload as { data: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Unsupported image provider response');
  }

  return data.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Unsupported image provider response');
    }

    const record = item as { url?: unknown; b64_json?: unknown };
    if (typeof record.url === 'string') {
      return { url: record.url, b64Json: null };
    }

    if (typeof record.b64_json === 'string') {
      return { url: null, b64Json: record.b64_json };
    }

    throw new Error('Unsupported image provider response');
  });
}

function extractProviderError(text: string): string {
  try {
    const payload = JSON.parse(text) as { error?: { message?: unknown } };
    if (typeof payload.error?.message === 'string') {
      return payload.error.message;
    }
  } catch {
    // Keep raw text below for non-JSON provider responses.
  }

  return text || 'Image provider rejected the request.';
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, externalSignal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  let timeoutExpired = false;
  const timeout = setTimeout(() => {
    timeoutExpired = true;
    controller.abort();
  }, timeoutMs);
  const abortFromExternalSignal = () => controller.abort();
  externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });
  if (externalSignal?.aborted) {
    controller.abort();
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ProviderError(timeoutExpired ? `Provider request timed out after ${timeoutMs} ms` : 'Provider request was canceled.');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternalSignal);
  }
}

async function requestProviderJson(
  config: ProviderConfig,
  event: 'provider.generate.response' | 'provider.edit.response',
  url: string,
  buildInit: () => RequestInit,
  upstreamRequest?: unknown
): Promise<unknown> {
  const maxAttempts = Math.max(1, (config.maxRetries ?? DEFAULT_PROVIDER_MAX_RETRIES) + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      captureTelemetryAttempt(config.telemetry, 'upstreamRequest', {
        url,
        attempt,
        maxAttempts,
        body: upstreamRequest
      });
      const response = await fetchWithTimeout(url, buildInit(), config.timeoutMs, config.signal);
      const text = await response.text();
      const upstreamResponse = {
        attempt,
        maxAttempts,
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type'),
        body: parseJsonOrText(text)
      };

      captureTelemetryAttempt(config.telemetry, 'upstreamResponse', upstreamResponse);

      logDiagnostic(event, {
        url,
        timeoutMs: config.timeoutMs,
        attempt,
        maxAttempts,
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type'),
        bodyPreview: text.slice(0, 600)
      });

      if (!response.ok) {
        const error = new ProviderError(extractProviderError(text), response.status, text);
        if (attempt < maxAttempts && isRetryableProviderError(error)) {
          await waitBeforeRetry(config, event, url, attempt, maxAttempts, error.message, response.status);
          continue;
        }

        throw error;
      }

      return text ? JSON.parse(text) : null;
    } catch (error) {
      const providerError = normalizeProviderError(error);
      if (!providerError.statusCode) {
        captureTelemetryAttempt(config.telemetry, 'upstreamResponse', {
          url,
          attempt,
          maxAttempts,
          ok: false,
          error: providerError.message
        });
      }
      if (attempt < maxAttempts && isRetryableProviderError(providerError)) {
        await waitBeforeRetry(config, event, url, attempt, maxAttempts, providerError.message, providerError.statusCode);
        continue;
      }

      throw providerError;
    }
  }

  throw new ProviderError('Image provider request failed after all retry attempts.');
}

function captureTelemetryAttempt(
  telemetry: ProviderTelemetryCapture | undefined,
  key: keyof ProviderTelemetryCapture,
  value: unknown
): void {
  if (!telemetry) {
    return;
  }

  const current = telemetry[key];
  if (!current) {
    telemetry[key] = value;
    return;
  }

  if (Array.isArray(current)) {
    telemetry[key] = [...current, value];
    return;
  }

  telemetry[key] = [current, value];
}

async function waitBeforeRetry(
  config: ProviderConfig,
  event: string,
  url: string,
  attempt: number,
  maxAttempts: number,
  details: string,
  statusCode?: number
) {
  const delayMs = Math.max(0, config.retryDelayMs ?? DEFAULT_PROVIDER_RETRY_DELAY_MS) * attempt;
  logDiagnostic('provider.request.retry', {
    sourceEvent: event,
    url,
    attempt,
    maxAttempts,
    nextAttempt: attempt + 1,
    delayMs,
    statusCode,
    details
  });

  if (delayMs > 0) {
    await waitWithAbort(delayMs, config.signal);
  }
}

function waitWithAbort(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new ProviderError('Provider request was canceled.'));
    };

    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
  });
}

function isRetryableProviderError(error: ProviderError): boolean {
  if (error.message.includes('timed out')) {
    return false;
  }

  if (error.message.includes('canceled')) {
    return false;
  }

  if (!error.statusCode) {
    return true;
  }

  return error.statusCode === 408 || error.statusCode === 409 || error.statusCode === 429 || error.statusCode >= 500;
}

function normalizeProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  return new ProviderError(`Provider network request failed: ${describeError(error)}`);
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = [error.message || error.name];
  const cause = (error as { cause?: unknown }).cause;
  const causeMessage = describeCause(cause);
  if (causeMessage && !parts.includes(causeMessage)) {
    parts.push(causeMessage);
  }

  return parts.filter(Boolean).join(' - ');
}

function describeCause(cause: unknown): string | null {
  if (!cause) {
    return null;
  }

  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === 'object') {
    const record = cause as { code?: unknown; message?: unknown };
    const code = typeof record.code === 'string' ? record.code : null;
    const message = typeof record.message === 'string' ? record.message : null;
    if (code && message) {
      return `${code}: ${message}`;
    }

    return code || message;
  }

  return String(cause);
}

export async function generateOpenAIImage(
  config: ProviderConfig,
  request: ImageGenerationRequest
): Promise<GeneratedImage[]> {
  const url = buildProviderUrl(config.baseUrl, '/images/generations');
  const upstreamRequest = {
    model: request.model,
    prompt: request.prompt,
    size: request.size,
    quality: request.quality,
    n: request.n
  };
  const payload = await requestProviderJson(config, 'provider.generate.response', url, () => ({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: upstreamRequest.model,
      prompt: upstreamRequest.prompt,
      size: upstreamRequest.size,
      quality: upstreamRequest.quality,
      n: upstreamRequest.n
    })
  }), upstreamRequest);

  return normalizeOpenAIImageResponse(payload);
}

export async function editOpenAIImage(
  config: ProviderConfig,
  fields: ImageEditFields,
  images: { buffer: Buffer; filename: string; mimetype: string }[]
): Promise<GeneratedImage[]> {
  const url = buildProviderUrl(config.baseUrl, '/images/edits');
  const upstreamRequest = {
    prompt: fields.prompt,
    model: fields.model,
    size: fields.size,
    quality: fields.quality,
    images: images.map((image) => ({
      filename: image.filename,
      mimetype: image.mimetype,
      bytes: image.buffer.byteLength
    }))
  };
  const payload = await requestProviderJson(config, 'provider.edit.response', url, () => ({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`
    },
    body: buildEditForm(fields, images)
  }), upstreamRequest);

  return normalizeOpenAIImageResponse(payload);
}

function parseJsonOrText(text: string): unknown {
  if (!text) {
    return '';
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildEditForm(fields: ImageEditFields, images: { buffer: Buffer; filename: string; mimetype: string }[]): FormData {
  const form = new FormData();
  form.set('prompt', fields.prompt);
  form.set('model', fields.model);
  form.set('size', fields.size);
  form.set('quality', fields.quality);
  for (const image of images) {
    const imageBytes = new Uint8Array(image.buffer);
    form.append('image', new Blob([imageBytes], { type: image.mimetype }), image.filename);
  }

  return form;
}
