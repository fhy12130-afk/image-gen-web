import type {
  ImageGenerationRequest,
  ImageHistoryResponse,
  ImageJobResponse,
  ImageJobsResponse,
  ImageQuality,
  ImageResponse,
  PublicConfig
} from '@image-gen-web/shared';

export async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = parseJsonOrNull(text);
  if (!response.ok) {
    const message = extractApiErrorMessage(payload) || text || 'Request failed';
    const requestId = response.headers.get('x-request-id');
    throw new Error(requestId ? `${message} (Request ID: ${requestId})` : message);
  }
  return payload as T;
}

function parseJsonOrNull(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) {
    return null;
  }

  const error = (payload as { error?: { message?: unknown; details?: unknown } }).error;
  const details = typeof error?.details === 'string' ? extractNestedErrorMessage(error.details) : null;
  if (details) {
    return details;
  }

  return typeof error?.message === 'string' ? error.message : null;
}

function extractNestedErrorMessage(details: string): string | null {
  try {
    const payload = JSON.parse(details) as { error?: { message?: unknown } };
    if (typeof payload.error?.message === 'string') {
      return payload.error.message;
    }
  } catch {
    // Keep raw details below for non-JSON provider responses.
  }

  return details || null;
}

export async function fetchPublicConfig(): Promise<PublicConfig> {
  return parseResponse<PublicConfig>(await fetch('/api/config/public'));
}

export async function generateImage(request: ImageGenerationRequest): Promise<ImageResponse> {
  return parseResponse<ImageResponse>(
    await fetch('/api/image/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    })
  );
}

export async function editImage(fields: {
  prompt: string;
  model: string;
  size: string;
  quality: ImageQuality;
  images: File[];
}): Promise<ImageResponse> {
  const form = new FormData();
  form.set('prompt', fields.prompt);
  form.set('model', fields.model);
  form.set('size', fields.size);
  form.set('quality', fields.quality);
  for (const image of fields.images) {
    form.append('image', image);
  }

  return parseResponse<ImageResponse>(
    await fetch('/api/image/edit', {
      method: 'POST',
      body: form
    })
  );
}

export function getDownloadUrl(imageUrl: string): string {
  return `/api/image/download?url=${encodeURIComponent(imageUrl)}`;
}

export async function queueImageGeneration(request: ImageGenerationRequest): Promise<ImageJobResponse> {
  return parseResponse<ImageJobResponse>(
    await fetch('/api/jobs/image/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    })
  );
}

export async function queueImageEdit(fields: {
  prompt: string;
  model: string;
  size: string;
  quality: ImageQuality;
  images: File[];
}): Promise<ImageJobResponse> {
  const form = new FormData();
  form.set('prompt', fields.prompt);
  form.set('model', fields.model);
  form.set('size', fields.size);
  form.set('quality', fields.quality);
  for (const image of fields.images) {
    form.append('image', image);
  }

  return parseResponse<ImageJobResponse>(
    await fetch('/api/jobs/image/edit', {
      method: 'POST',
      body: form
    })
  );
}

export async function fetchJobs(): Promise<ImageJobsResponse> {
  return parseResponse<ImageJobsResponse>(await fetch('/api/jobs'));
}

export async function retryImageJob(jobId: string): Promise<ImageJobResponse> {
  return parseResponse<ImageJobResponse>(
    await fetch(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST'
    })
  );
}

export async function cancelImageJob(jobId: string): Promise<ImageJobResponse> {
  return parseResponse<ImageJobResponse>(
    await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST'
    })
  );
}

export async function clearFinishedJobs(): Promise<ImageJobsResponse> {
  return parseResponse<ImageJobsResponse>(
    await fetch('/api/jobs', {
      method: 'DELETE'
    })
  );
}

export async function fetchHistory(): Promise<ImageHistoryResponse> {
  return parseResponse<ImageHistoryResponse>(await fetch('/api/history'));
}

export async function clearHistory(): Promise<ImageHistoryResponse> {
  return parseResponse<ImageHistoryResponse>(
    await fetch('/api/history', {
      method: 'DELETE'
    })
  );
}
