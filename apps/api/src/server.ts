import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAdminApp } from './adminApp.js';
import { buildApp } from './app.js';
import { loadConfigFromEnvFile } from './config.js';
import { createHistoryStore } from './historyStore.js';
import { editOpenAIImage, generateOpenAIImage } from './provider/openaiImageProvider.js';
import { applyStoredSettings, createSettingsStore } from './settingsStore.js';
import { createTelemetryStore } from './telemetryStore.js';

const config = loadConfigFromEnvFile();
const apiDir = dirname(fileURLToPath(import.meta.url));
const dataDir = join(apiDir, '..', 'data');
const settingsStore = createSettingsStore(join(dataDir, 'settings.json'));
applyStoredSettings(config, await settingsStore.loadSettings());
const telemetryStore = createTelemetryStore(join(dataDir, 'telemetry.jsonl'));
const historyStore = createHistoryStore({
  dataDir,
  publicBaseUrl: ''
});
const webDistDir = join(apiDir, '..', '..', 'web', 'dist');
const app = buildApp({
  config,
  provider: {
    generate: (request, provider, signal, context) =>
      generateOpenAIImage(
        {
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          timeoutMs: config.imageApiTimeoutMs,
          maxRetries: config.imageApiMaxRetries,
          retryDelayMs: config.imageApiRetryDelayMs,
          signal,
          telemetry: context?.telemetry
        },
        request
      ),
    edit: (fields, image, provider, signal, context) =>
      editOpenAIImage(
        {
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          timeoutMs: config.imageApiTimeoutMs,
          maxRetries: config.imageApiMaxRetries,
          retryDelayMs: config.imageApiRetryDelayMs,
          signal,
          telemetry: context?.telemetry
        },
        fields,
        image
      )
  },
  historyStore,
  settingsStore,
  telemetryStore,
  staticDir: webDistDir
});
const adminApp = buildAdminApp({
  runtime: app.imageGenRuntime,
  username: config.adminUsername || 'admin',
  password: config.adminPassword || ''
});

await app.listen({ port: config.apiPort, host: '0.0.0.0' });
app.server.timeout = config.imageApiTimeoutMs;
app.server.requestTimeout = config.imageApiTimeoutMs;
app.server.headersTimeout = config.imageApiTimeoutMs + 1000;
app.server.keepAliveTimeout = config.imageApiTimeoutMs;
console.log(`API server listening on http://localhost:${config.apiPort}`);

await adminApp.listen({ port: config.adminPort || 8850, host: '0.0.0.0' });
console.log(`Admin server listening on http://localhost:${config.adminPort || 8850}`);
