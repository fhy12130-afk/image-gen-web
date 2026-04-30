import { describe, expect, it } from 'vitest';
import { formatBytes, toCompressedFileName, type ImageCompressionRecord } from './imageCompression';

describe('formatBytes', () => {
  it('formats bytes using compact units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});

describe('toCompressedFileName', () => {
  it('keeps the original base name and uses jpg extension', () => {
    expect(toCompressedFileName('reference image.png')).toBe('reference image-compressed.jpg');
    expect(toCompressedFileName('portrait')).toBe('portrait-compressed.jpg');
  });
});

describe('ImageCompressionRecord', () => {
  it('describes compressed image metadata', () => {
    const file = new File(['abc'], 'reference-compressed.jpg', { type: 'image/jpeg' });
    const record: ImageCompressionRecord = {
      file,
      originalName: 'reference.png',
      originalBytes: 10,
      compressedBytes: 3,
      status: 'compressed'
    };

    expect(record).toMatchObject({
      originalName: 'reference.png',
      originalBytes: 10,
      compressedBytes: 3,
      status: 'compressed'
    });
  });
});
