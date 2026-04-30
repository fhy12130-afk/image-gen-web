import { describe, expect, it } from 'vitest';
import { appendDiagnosticLogLine, createRequestId, maskForLog, summarizeImages } from './diagnostics';

describe('diagnostics', () => {
  it('creates short request ids with a prefix', () => {
    expect(createRequestId('edit')).toMatch(/^edit-[a-z0-9]+-[a-z0-9]+$/);
  });

  it('masks secrets without exposing the full value', () => {
    expect(maskForLog('sk-abcdefghijklmnopqrstuvwxyz')).toBe('sk-abc...xyz');
  });

  it('summarizes uploaded images without buffers', () => {
    expect(
      summarizeImages([
        { filename: 'a.png', mimetype: 'image/png', buffer: Buffer.from([1, 2, 3]) }
      ])
    ).toEqual([{ filename: 'a.png', mimetype: 'image/png', bytes: 3 }]);
  });

  it('formats diagnostic log lines as JSON lines', () => {
    const line = appendDiagnosticLogLine('image.edit.start', { requestId: 'edit-test' });

    expect(JSON.parse(line)).toMatchObject({ event: 'image.edit.start', requestId: 'edit-test' });
    expect(line.endsWith('\n')).toBe(true);
  });
});
