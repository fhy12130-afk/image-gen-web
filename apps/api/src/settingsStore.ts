import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ApiSettingsUpdate } from '@image-gen-web/shared';
import type { ApiConfig } from './config.js';
import { normalizeBaseUrl } from './config.js';

export type StoredApiSettings = {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  maxParallelImageJobs?: number;
};

export type SettingsStore = ReturnType<typeof createSettingsStore>;

export function applyStoredSettings(config: ApiConfig, settings: StoredApiSettings): ApiConfig {
  if (typeof settings.baseUrl === 'string') {
    config.baseUrl = settings.baseUrl ? normalizeBaseUrl(settings.baseUrl) : '';
  }

  if (typeof settings.apiKey === 'string') {
    config.apiKey = settings.apiKey;
  }

  if (typeof settings.defaultModel === 'string' && settings.defaultModel.trim()) {
    config.defaultModel = settings.defaultModel.trim();
  }

  if (typeof settings.maxParallelImageJobs === 'number') {
    config.maxParallelImageJobs = Math.max(1, settings.maxParallelImageJobs);
  }

  return config;
}

export function applySettingsUpdate(config: ApiConfig, update: ApiSettingsUpdate): ApiConfig {
  if ('baseUrl' in update && typeof update.baseUrl === 'string') {
    config.baseUrl = update.baseUrl ? normalizeBaseUrl(update.baseUrl) : '';
  }

  if ('apiKey' in update && typeof update.apiKey === 'string' && update.apiKey.trim()) {
    config.apiKey = update.apiKey.trim();
  }

  if (update.defaultModel) {
    config.defaultModel = update.defaultModel;
  }

  if (update.maxParallelImageJobs) {
    config.maxParallelImageJobs = update.maxParallelImageJobs;
  }

  return config;
}

export function toStoredSettings(config: ApiConfig): StoredApiSettings {
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    defaultModel: config.defaultModel,
    maxParallelImageJobs: config.maxParallelImageJobs
  };
}

export function createSettingsStore(settingsPath: string) {
  return {
    async loadSettings(): Promise<StoredApiSettings> {
      try {
        return JSON.parse(await readFile(settingsPath, 'utf8')) as StoredApiSettings;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return {};
        }

        throw error;
      }
    },

    async saveSettings(settings: StoredApiSettings): Promise<void> {
      await mkdir(dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    }
  };
}
