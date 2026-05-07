import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { AppRuntime } from './app.js';
import { apiError } from './errors.js';
import { toStoredSettings } from './settingsStore.js';

export function buildAdminApp(options: { runtime: AppRuntime; username: string; password: string }) {
  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (request, reply) => {
    if (isAuthorized(request.headers.authorization, options.username, options.password)) {
      return;
    }

    reply.header('www-authenticate', 'Basic realm="Image Gen Admin"');
    return reply.status(401).send('Authentication required');
  });

  app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(adminHtml()));

  app.get('/api/summary', async () => {
    const stats = options.runtime.jobQueue.stats();
    const summary = await options.runtime.telemetryStore?.summary();
    return {
      runtime: {
        maxParallel: stats.maxParallel,
        maxQueuedJobs: stats.maxQueuedJobs,
        maxStoredJobs: stats.maxStoredJobs,
        maxUserParallel: stats.maxUserParallel,
        runningCount: stats.runningCount,
        queuedCount: stats.queuedCount
      },
      summary: summary || {
        windows: {
          '24h': { requests: 0, jobs: 0, failures: 0, success: 0 },
          '7d': { requests: 0, jobs: 0, failures: 0, success: 0 },
          '30d': { requests: 0, jobs: 0, failures: 0, success: 0 }
        },
        recentErrors: []
      }
    };
  });

  app.get('/api/logs', async (request) => {
    const query = request.query as { limit?: string; level?: 'info' | 'error'; type?: string };
    return {
      events: await options.runtime.telemetryStore?.list({
        limit: Number(query.limit || 300),
        level: query.level,
        type: query.type
      })
    };
  });

  app.get('/api/errors', async () => ({
    events: await options.runtime.telemetryStore?.list({ limit: 300, level: 'error' })
  }));

  app.get('/api/runtime', async () => ({
    maxParallel: options.runtime.jobQueue.stats().maxParallel,
    configMaxParallel: options.runtime.config.maxParallelImageJobs
  }));

  app.put('/api/runtime', async (request, reply) => {
    const body = request.body as { maxParallel?: unknown };
    const maxParallel = Number(body.maxParallel);
    if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 100) {
      return reply.status(400).send(apiError('VALIDATION_ERROR', 'maxParallel must be an integer from 1 to 100.'));
    }

    options.runtime.config.maxParallelImageJobs = maxParallel;
    options.runtime.jobQueue.setMaxParallel(maxParallel);
    await options.runtime.settingsStore?.saveSettings(toStoredSettings(options.runtime.config));
    await options.runtime.telemetryStore?.record({
      type: 'admin.runtime.update',
      level: 'info',
      status: 'updated',
      prompt: `maxParallel=${maxParallel}`
    });

    return { maxParallel };
  });

  return app;
}

function isAuthorized(header: string | undefined, username: string, password: string): boolean {
  if (!header?.startsWith('Basic ')) {
    return false;
  }

  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) {
    return false;
  }

  return safeEqual(decoded.slice(0, separatorIndex), username) && safeEqual(decoded.slice(separatorIndex + 1), password);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function adminHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Image Gen Admin</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #1f2933; }
    header { padding: 20px 28px; background: #fff; border-bottom: 1px solid #d9dee5; display: flex; justify-content: space-between; align-items: center; }
    h1 { margin: 0; font-size: 22px; }
    main { padding: 24px 28px 40px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .card, .panel { background: #fff; border: 1px solid #d9dee5; border-radius: 8px; padding: 16px; }
    .card span { display: block; color: #657282; font-size: 12px; }
    .card strong { display: block; font-size: 26px; margin-top: 6px; }
    .panel { margin-top: 18px; overflow: hidden; }
    .panel-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
    h2 { margin: 0; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; border-bottom: 1px solid #e8ebef; padding: 8px; vertical-align: top; }
    th { color: #657282; font-weight: 600; background: #fafbfc; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    pre { max-width: 520px; max-height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-word; background: #f6f7f9; border: 1px solid #e1e6ed; border-radius: 6px; padding: 8px; }
    input, select, button { font: inherit; border: 1px solid #c9d1dc; border-radius: 6px; padding: 8px 10px; background: #fff; }
    button { cursor: pointer; background: #1f6feb; color: #fff; border-color: #1f6feb; }
    .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .error { color: #b42318; }
    .ok { color: #067647; }
    @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } table { min-width: 900px; } .panel { overflow-x: auto; } }
  </style>
</head>
<body>
  <header>
    <h1>Image Gen Admin</h1>
    <div class="controls">
      <label>全局并发 <input id="maxParallel" type="number" min="1" max="100" style="width:80px" /></label>
      <button id="saveRuntime">保存</button>
      <button id="refresh">刷新</button>
    </div>
  </header>
  <main>
    <section class="grid" id="cards"></section>
    <section class="panel">
      <div class="panel-header">
        <h2>最近错误</h2>
      </div>
      <table><thead><tr><th>时间</th><th>Request ID</th><th>Job ID</th><th>类型</th><th>错误</th></tr></thead><tbody id="errors"></tbody></table>
    </section>
    <section class="panel">
      <div class="panel-header">
        <h2>请求与任务日志</h2>
        <div class="controls">
          <select id="level"><option value="">全部</option><option value="error">错误</option><option value="info">信息</option></select>
          <input id="search" placeholder="搜索 request id / job id / client / error" style="width:280px" />
        </div>
      </div>
      <table><thead><tr><th>时间</th><th>级别</th><th>类型</th><th>状态</th><th>Request ID</th><th>Job ID</th><th>Client</th><th>模型/尺寸</th><th>耗时</th><th>错误/URL</th><th>详情</th></tr></thead><tbody id="logs"></tbody></table>
    </section>
  </main>
  <script>
    const cards = document.querySelector('#cards');
    const logs = document.querySelector('#logs');
    const errors = document.querySelector('#errors');
    const maxParallel = document.querySelector('#maxParallel');
    const level = document.querySelector('#level');
    const search = document.querySelector('#search');

    document.querySelector('#refresh').addEventListener('click', load);
    level.addEventListener('change', loadLogs);
    search.addEventListener('input', () => renderLogs(window.__events || []));
    document.querySelector('#saveRuntime').addEventListener('click', async () => {
      await fetch('/api/runtime', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maxParallel: Number(maxParallel.value) }) });
      await load();
    });

    async function load() {
      const data = await fetch('/api/summary').then((response) => response.json());
      maxParallel.value = data.runtime.maxParallel;
      const windows = data.summary.windows;
      cards.innerHTML = [
        card('24h 请求', windows['24h'].requests),
        card('7天请求', windows['7d'].requests),
        card('30天请求', windows['30d'].requests),
        card('24h 任务', windows['24h'].jobs),
        card('24h 成功', windows['24h'].success),
        card('24h 错误', windows['24h'].failures),
        card('运行中', data.runtime.runningCount),
        card('排队中', data.runtime.queuedCount)
      ].join('');
      renderErrors(data.summary.recentErrors || []);
      await loadLogs();
    }

    async function loadLogs() {
      const selectedLevel = level.value ? '&level=' + encodeURIComponent(level.value) : '';
      const data = await fetch('/api/logs?limit=300' + selectedLevel).then((response) => response.json());
      window.__events = data.events || [];
      renderLogs(window.__events);
    }

    function card(label, value) {
      return '<div class="card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value)) + '</strong></div>';
    }

    function renderErrors(events) {
      errors.innerHTML = events.map((event) =>
        '<tr><td>' + time(event.time) + '</td><td><code>' + escapeHtml(event.requestId || '') + '</code></td><td><code>' +
        escapeHtml(event.jobId || '') + '</code></td><td>' + escapeHtml(event.type) + '</td><td class="error">' + escapeHtml(event.error || event.url || '') + '</td></tr>'
      ).join('');
    }

    function renderLogs(events) {
      const term = search.value.trim().toLowerCase();
      const filtered = term ? events.filter((event) => JSON.stringify(event).toLowerCase().includes(term)) : events;
      logs.innerHTML = filtered.map((event) =>
        '<tr><td>' + time(event.time) + '</td><td class="' + (event.level === 'error' ? 'error' : 'ok') + '">' + escapeHtml(event.level) +
        '</td><td>' + escapeHtml(event.type) + '</td><td>' + escapeHtml(event.status || event.statusCode || '') + '</td><td><code>' +
        escapeHtml(event.requestId || '') + '</code></td><td><code>' + escapeHtml(event.jobId || '') + '</code></td><td><code>' +
        escapeHtml(event.clientId || '') + '</code></td><td>' + escapeHtml([event.model, event.size, event.quality].filter(Boolean).join(' / ')) +
        '</td><td>' + escapeHtml(event.durationMs == null ? '' : event.durationMs + ' ms') + '</td><td>' + escapeHtml(event.error || event.url || event.prompt || '') +
        '</td><td>' + details(event) + '</td></tr>'
      ).join('');
    }

    function details(event) {
      const payload = {
        requestBody: event.requestBody,
        upstreamRequest: event.upstreamRequest,
        upstreamResponse: event.upstreamResponse,
        details: event.details
      };
      if (!payload.requestBody && !payload.upstreamRequest && !payload.upstreamResponse && !payload.details) {
        return '';
      }
      return '<details><summary>查看</summary><pre>' + escapeHtml(JSON.stringify(payload, null, 2)) + '</pre></details>';
    }

    function time(value) { return value ? new Date(value).toLocaleString() : ''; }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
    load();
  </script>
</body>
</html>`;
}
