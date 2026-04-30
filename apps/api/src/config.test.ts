import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfigFromEnvFile } from './config';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('loadConfigFromEnvFile', () => {
  it('loads image provider settings from a project .env file', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'image-gen-web-'));
    writeFileSync(
      join(tempDir, '.env'),
      [
        'IMAGE_API_BASE_URL=https://api.example.com/v1',
        'IMAGE_API_KEY=test-key',
        'DEFAULT_IMAGE_MODEL=gpt-image-2',
        'API_PORT=9999',
        'WEB_ORIGIN=http://localhost:5173'
      ].join('\n')
    );

    const config = loadConfigFromEnvFile(tempDir, {});

    expect(config.baseUrl).toBe('https://api.example.com/v1');
    expect(config.apiKey).toBe('test-key');
    expect(config.defaultModel).toBe('gpt-image-2');
    expect(config.apiPort).toBe(9999);
    expect(config.imageApiTimeoutMs).toBe(900000);
    expect(config.imageApiMaxRetries).toBe(2);
    expect(config.imageApiRetryDelayMs).toBe(8000);
    expect(config.maxParallelImageJobs).toBe(2);
  });

  it('normalizes a full image generation endpoint to the provider base URL', () => {
    const config = loadConfigFromEnvFile(process.cwd(), {
      IMAGE_API_BASE_URL: 'https://www.aaaapi.fun/v1/images/generations',
      IMAGE_API_KEY: 'test-key'
    });

    expect(config.baseUrl).toBe('https://www.aaaapi.fun/v1');
  });

  it('allows overriding provider timeout from env', () => {
    const config = loadConfigFromEnvFile(process.cwd(), {
      IMAGE_API_BASE_URL: 'https://api.example.com/v1',
      IMAGE_API_KEY: 'test-key',
      IMAGE_API_TIMEOUT_MS: '1200000'
    });

    expect(config.imageApiTimeoutMs).toBe(1200000);
  });

  it('allows overriding max parallel image jobs from env', () => {
    const config = loadConfigFromEnvFile(process.cwd(), {
      IMAGE_API_BASE_URL: 'https://api.example.com/v1',
      IMAGE_API_KEY: 'test-key',
      MAX_PARALLEL_IMAGE_JOBS: '8'
    });

    expect(config.maxParallelImageJobs).toBe(8);
  });

  it('allows overriding provider retry settings from env', () => {
    const config = loadConfigFromEnvFile(process.cwd(), {
      IMAGE_API_BASE_URL: 'https://api.example.com/v1',
      IMAGE_API_KEY: 'test-key',
      IMAGE_API_MAX_RETRIES: '4',
      IMAGE_API_RETRY_DELAY_MS: '12000'
    });

    expect(config.imageApiMaxRetries).toBe(4);
    expect(config.imageApiRetryDelayMs).toBe(12000);
  });
});
