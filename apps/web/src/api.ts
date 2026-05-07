import type {
  ImageGenerationRequest,
  ImageHistoryResponse,
  ImageJobResponse,
  ImageJobsResponse,
  ImageQuality,
  ImageResponse,
  ApiSettingsResponse,
  ApiSettingsUpdate,
  ClientJobSettings,
  ProviderCredentials,
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

export async function fetchSettings(): Promise<ApiSettingsResponse> {
  return parseResponse<ApiSettingsResponse>(await fetch('/api/settings'));
}

export async function updateSettings(settings: ApiSettingsUpdate): Promise<ApiSettingsResponse> {
  return parseResponse<ApiSettingsResponse>(
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    })
  );
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
  provider?: ProviderCredentials;
  client?: ClientJobSettings;
}): Promise<ImageResponse> {
  const form = new FormData();
  form.set('prompt', fields.prompt);
  form.set('model', fields.model);
  form.set('size', fields.size);
  form.set('quality', fields.quality);
  appendProviderFields(form, fields.provider);
  appendClientFields(form, fields.client);
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
  provider?: ProviderCredentials;
  client?: ClientJobSettings;
}): Promise<ImageJobResponse> {
  const form = new FormData();
  form.set('prompt', fields.prompt);
  form.set('model', fields.model);
  form.set('size', fields.size);
  form.set('quality', fields.quality);
  appendProviderFields(form, fields.provider);
  appendClientFields(form, fields.client);
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

export async function fetchJobs(clientId?: string): Promise<ImageJobsResponse> {
  return parseResponse<ImageJobsResponse>(await fetch(withClientQuery('/api/jobs', clientId)));
}

export async function retryImageJob(jobId: string, provider?: ProviderCredentials, client?: ClientJobSettings): Promise<ImageJobResponse> {
  return parseResponse<ImageJobResponse>(
    await fetch(withClientQuery(`/api/jobs/${encodeURIComponent(jobId)}/retry`, client?.id), {
      method: 'POST',
      ...(provider || client
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, client })
          }
        : {})
    })
  );
}

export async function cancelImageJob(jobId: string, clientId?: string): Promise<ImageJobResponse> {
  return parseResponse<ImageJobResponse>(
    await fetch(withClientQuery(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, clientId), {
      method: 'POST'
    })
  );
}

export async function clearFinishedJobs(clientId?: string): Promise<ImageJobsResponse> {
  return parseResponse<ImageJobsResponse>(
    await fetch(withClientQuery('/api/jobs', clientId), {
      method: 'DELETE'
    })
  );
}

export async function fetchHistory(clientId?: string): Promise<ImageHistoryResponse> {
  return parseResponse<ImageHistoryResponse>(await fetch(withClientQuery('/api/history', clientId)));
}

export async function clearHistory(clientId?: string): Promise<ImageHistoryResponse> {
  return parseResponse<ImageHistoryResponse>(
    await fetch(withClientQuery('/api/history', clientId), {
      method: 'DELETE'
    })
  );
}

function appendProviderFields(form: FormData, provider?: ProviderCredentials): void {
  if (!provider) {
    return;
  }

  if (provider.baseUrl) {
    form.set('providerBaseUrl', provider.baseUrl);
  }
  form.set('providerApiKey', provider.apiKey);
}

function appendClientFields(form: FormData, client?: ClientJobSettings): void {
  if (!client) {
    return;
  }

  form.set('clientId', client.id);
  form.set('clientMaxParallelJobs', String(client.maxParallelJobs));
}

function withClientQuery(path: string, clientId?: string): string {
  if (!clientId) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}clientId=${encodeURIComponent(clientId)}`;
}
