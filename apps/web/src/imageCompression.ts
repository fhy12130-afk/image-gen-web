export type ImageCompressionStatus = 'compressed' | 'unchanged' | 'failed';

export type ImageCompressionRecord = {
  file: File;
  originalName: string;
  originalBytes: number;
  compressedBytes: number;
  status: ImageCompressionStatus;
};

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return exponent === 0 ? `${value} ${units[exponent]}` : `${value.toFixed(1)} ${units[exponent]}`;
}

export function toCompressedFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  const baseName = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  return `${baseName}-compressed.jpg`;
}

function getTargetSize(width: number, height: number): { width: number; height: number } {
  const largestSide = Math.max(width, height);
  if (largestSide <= MAX_DIMENSION) {
    return { width, height };
  }

  const scale = MAX_DIMENSION / largestSide;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale)
  };
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
}

export async function compressImageFile(file: File): Promise<ImageCompressionRecord> {
  if (!file.type.startsWith('image/')) {
    return {
      file,
      originalName: file.name,
      originalBytes: file.size,
      compressedBytes: file.size,
      status: 'unchanged'
    };
  }

  try {
    const image = await loadImage(file);
    const target = getTargetSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Canvas is not available.');
    }

    context.drawImage(image, 0, 0, target.width, target.height);
    const blob = await canvasToBlob(canvas);

    if (!blob || blob.size >= file.size) {
      return {
        file,
        originalName: file.name,
        originalBytes: file.size,
        compressedBytes: file.size,
        status: 'unchanged'
      };
    }

    const compressedFile = new File([blob], toCompressedFileName(file.name), { type: 'image/jpeg' });
    return {
      file: compressedFile,
      originalName: file.name,
      originalBytes: file.size,
      compressedBytes: compressedFile.size,
      status: 'compressed'
    };
  } catch {
    return {
      file,
      originalName: file.name,
      originalBytes: file.size,
      compressedBytes: file.size,
      status: 'failed'
    };
  }
}
