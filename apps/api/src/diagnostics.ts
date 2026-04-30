import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { UploadedImage } from './app';

export function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function maskForLog(value: string): string {
  if (value.length <= 12) {
    return '***';
  }

  return `${value.slice(0, 6)}...${value.slice(-3)}`;
}

export function summarizeImages(images: UploadedImage[]) {
  return images.map((image) => ({
    filename: image.filename,
    mimetype: image.mimetype,
    bytes: image.buffer.length
  }));
}

export function logDiagnostic(event: string, payload: Record<string, unknown>) {
  const line = appendDiagnosticLogLine(event, payload);
  console.log(line.trimEnd());

  try {
    const logsDir = resolve(process.cwd(), 'logs');
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(resolve(logsDir, 'api.log'), line, 'utf8');
  } catch {
    // Console logging is the primary diagnostic path. File logging is best-effort.
  }
}

export function appendDiagnosticLogLine(event: string, payload: Record<string, unknown>): string {
  return `${JSON.stringify({ time: new Date().toISOString(), event, ...payload })}\n`;
}
