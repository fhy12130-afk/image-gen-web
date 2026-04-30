import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { loadConfigFromEnvFile } from './config';
import { createHistoryStore } from './historyStore';
import { editOpenAIImage, generateOpenAIImage } from './provider/openaiImageProvider';

const config = loadConfigFromEnvFile();
const apiDir = dirname(fileURLToPath(import.meta.url));
const historyStore = createHistoryStore({
  dataDir: join(apiDir, '..', 'data'),
  publicBaseUrl: `http://localhost:${config.apiPort}`
});
const app = buildApp({
  config,
  provider: {
    generate: (request) =>
      generateOpenAIImage(
        {
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          timeoutMs: config.imageApiTimeoutMs,
          maxRetries: config.imageApiMaxRetries,
          retryDelayMs: config.imageApiRetryDelayMs
        },
        request
      ),
    edit: (fields, image) =>
      editOpenAIImage(
        {
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          timeoutMs: config.imageApiTimeoutMs,
          maxRetries: config.imageApiMaxRetries,
          retryDelayMs: config.imageApiRetryDelayMs
        },
        fields,
        image
      )
  },
  historyStore
});

await app.listen({ port: config.apiPort, host: '0.0.0.0' });
app.server.timeout = config.imageApiTimeoutMs;
app.server.requestTimeout = config.imageApiTimeoutMs;
app.server.headersTimeout = config.imageApiTimeoutMs + 1000;
app.server.keepAliveTimeout = config.imageApiTimeoutMs;
console.log(`API server listening on http://localhost:${config.apiPort}`);
