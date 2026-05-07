import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

export type ApiConfig = {
  apiPort: number;
  adminPort?: number;
  adminUsername?: string;
  adminPassword?: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  webOrigin: string;
  imageApiTimeoutMs: number;
  imageApiMaxRetries?: number;
  imageApiRetryDelayMs?: number;
  maxParallelImageJobs: number;
  maxUserParallelImageJobs?: number;
  maxQueuedImageJobs: number;
  maxStoredImageJobs: number;
};

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/images\/(generations|edits)$/i, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const baseUrl = env.IMAGE_API_BASE_URL || '';
  const apiKey = env.IMAGE_API_KEY || '';
  const defaultModel = env.DEFAULT_IMAGE_MODEL || 'gptimage2';

  return {
    apiPort: Number(env.API_PORT || 8700),
    adminPort: Number(env.ADMIN_PORT || 8850),
    adminUsername: env.ADMIN_USERNAME || 'admin',
    adminPassword: env.ADMIN_PASSWORD || '',
    baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : '',
    apiKey,
    defaultModel,
    webOrigin: env.WEB_ORIGIN || 'http://localhost:5173',
    imageApiTimeoutMs: Number(env.IMAGE_API_TIMEOUT_MS || 900000),
    imageApiMaxRetries: Math.max(0, Number(env.IMAGE_API_MAX_RETRIES || 2)),
    imageApiRetryDelayMs: Math.max(0, Number(env.IMAGE_API_RETRY_DELAY_MS || 8000)),
    maxParallelImageJobs: Math.max(1, Number(env.MAX_PARALLEL_IMAGE_JOBS || 2)),
    maxUserParallelImageJobs: Math.max(1, Number(env.MAX_USER_PARALLEL_IMAGE_JOBS || 20)),
    maxQueuedImageJobs: Math.max(1, Number(env.MAX_QUEUED_IMAGE_JOBS || 30)),
    maxStoredImageJobs: Math.max(1, Number(env.MAX_STORED_IMAGE_JOBS || 100))
  };
}

export function loadConfigFromEnvFile(projectRoot = resolve(process.cwd(), '..', '..'), env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const fileEnv: Record<string, string> = {};
  const parsed = loadDotenv({ path: resolve(projectRoot, '.env'), processEnv: fileEnv }).parsed || {};
  return loadConfig({ ...env, ...parsed });
}
