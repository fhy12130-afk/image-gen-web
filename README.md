# Image Gen Web

一个面向多人使用的 OpenAI 兼容图片生成网页。用户打开网页后可以填写自己的 API Key，也可以使用站点默认的上游接口地址；每个浏览器用户都有独立的 client id 和并发设置，服务端再用全局队列统一控流。

这个版本适合把网页直接部署到服务器上公开访问：前台给用户生图，后台单独跑在管理端口，用来查看 24 小时、7 天、30 天调用统计，检查成功/失败日志，并调整全局并发。

## 主要功能

- 文生图：调用 OpenAI 兼容的 `/images/generations`。
- 图生图/图片编辑：调用 OpenAI 兼容的 `/images/edits`。
- BYOK：用户在网页里填写自己的 API Key，服务端不会要求全局必须配置 Key。
- 默认上游地址：站点可配置默认 `IMAGE_API_BASE_URL`，用户也可以自己覆盖上游地址。
- 多人并发：每个用户可调整自己的并发数，服务端还有全局并发上限。
- 任务队列：支持排队、运行、成功、失败、取消和失败重试。
- 历史记录：成功图片会保存到服务端本地，支持预览、恢复参数和下载。
- 管理后台：独立端口，Basic Auth 保护，可查看统计、日志、错误和队列状态。
- 关键日志：只保存生图请求、成功、失败三类日志；API Key、Authorization、token、secret、password 会脱敏。
- 日志保留：本地 JSONL 日志自动清理 7 天以前的数据。
- Docker 部署：一个容器同时托管前端静态文件、API 和管理后台。
- MCP Server：保留本地 MCP stdio server，方便 Codex、Claude Desktop 等客户端调用本地 API。

## 项目结构

```text
apps/web            React + Vite 前端
apps/api            Fastify API、任务队列、管理后台、日志存储
apps/mcp            MCP stdio server
packages/shared     前后端和 MCP 共享的 TypeScript 协议
docs/plans          设计和实现记录
scripts             启动脚本测试
```

## 快速部署

先复制环境变量文件：

```bash
cp .env.example .env
```

编辑 `.env`，至少建议配置：

```env
IMAGE_API_BASE_URL=https://your-image-api.example.com/v1
IMAGE_API_KEY=
DEFAULT_IMAGE_MODEL=gpt-image-2
MAX_PARALLEL_IMAGE_JOBS=20
MAX_USER_PARALLEL_IMAGE_JOBS=20
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
```

然后启动：

```bash
docker compose -f compose.server.yml up -d --build
```

默认端口：

```text
前台 Web + API: http://localhost:8700
管理后台:       http://localhost:8850
```

`compose.server.yml` 默认把前台端口绑定在 `127.0.0.1:8700`，适合前面放 Caddy、Nginx 之类的反代；管理后台 `8850` 默认对外开放，但有 Basic Auth。生产环境请务必设置强密码，必要时再用防火墙限制访问来源。

## 用户使用方式

前台网页会默认使用服务端配置的 `IMAGE_API_BASE_URL`。用户只需要填自己的 API Key、模型、提示词和图片参数即可发起生图。

如果用户有自己的兼容接口地址，也可以在网页里覆盖上游 URL。服务端会把请求转发到：

```text
{baseUrl}/images/generations
{baseUrl}/images/edits
```

用户侧并发由浏览器里的 client 设置控制，服务端会同时受全局并发限制保护。

## 管理后台

管理后台地址由 `ADMIN_PORT` 控制，默认是 `8850`。登录使用：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
```

后台可以查看：

- 24 小时、7 天、30 天请求数、成功数、失败数。
- 当前全局并发、队列数量、运行数量。
- 最近日志和错误列表。
- 每条日志的 request id、client id、模型、尺寸、质量、耗时、错误信息。
- 前端提交的请求体。
- 转发到上游的请求体。
- 上游返回的响应内容。
- 全局并发上限调整。

## 日志策略

日志文件保存在 Docker volume 里：

```text
/app/apps/api/data/telemetry.jsonl
```

如果使用默认 compose，在宿主机上通常对应：

```text
/var/lib/docker/volumes/image-gen-web-data/_data/telemetry.jsonl
```

只会持久化三类事件：

- `image.request`
- `image.success`
- `image.failure`

不会保存普通 HTTP 请求、轮询、队列开始/取消等杂项日志。日志写入时会自动脱敏这些字段：

```text
authorization
apiKey
token
secret
password
```

日志最多保留 7 天。因为本地只保留 7 天数据，管理后台里的 30 天统计在默认配置下也只能统计现存日志。

## 环境变量

常用变量：

```env
IMAGE_API_BASE_URL=https://your-image-api.example.com/v1
IMAGE_API_KEY=
DEFAULT_IMAGE_MODEL=gpt-image-2
IMAGE_API_TIMEOUT_MS=900000
IMAGE_API_MAX_RETRIES=2
IMAGE_API_RETRY_DELAY_MS=8000

MAX_PARALLEL_IMAGE_JOBS=20
MAX_USER_PARALLEL_IMAGE_JOBS=20
MAX_QUEUED_IMAGE_JOBS=30
MAX_STORED_IMAGE_JOBS=100

API_PORT=8700
ADMIN_PORT=8850
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password

WEB_ORIGIN=http://localhost:5173
IMAGE_GEN_API_URL=http://localhost:8700
DOCKER_NODE_IMAGE=node:20-bookworm-slim
```

说明：

- `IMAGE_API_BASE_URL` 是默认上游地址，用户不填自定义 URL 时会使用它。
- `IMAGE_API_KEY` 可以留空，让用户在网页里填写自己的 Key。
- `MAX_PARALLEL_IMAGE_JOBS` 是服务端全局并发。
- `MAX_USER_PARALLEL_IMAGE_JOBS` 是单个用户可设置的并发上限。
- `IMAGE_API_MAX_RETRIES` 和 `IMAGE_API_RETRY_DELAY_MS` 用于临时网络错误、429、5xx 等重试。

## 本地开发

安装依赖：

```bash
npx pnpm@9.15.4 install
```

启动开发服务：

```bash
npx pnpm@9.15.4 dev
```

构建：

```bash
npx pnpm@9.15.4 build
```

测试：

```bash
npx pnpm@9.15.4 --filter @image-gen-web/shared test
npx pnpm@9.15.4 --filter @image-gen-web/api test
npx pnpm@9.15.4 --filter @image-gen-web/web test
```

## 图片参数

内置尺寸：

- `auto`
- `1024x1024`
- `1536x1024`
- `1024x1536`
- `2048x2048`
- `2048x1152`
- `3840x2160`
- `2160x3840`

质量选项：

- `low`
- `medium`
- `high`

自定义尺寸需要满足：

- `WIDTHxHEIGHT` 格式。
- 宽和高都不超过 `3840`。
- 宽和高都是 `16` 的倍数。
- 长宽比不超过 `3:1`。
- 总像素在 `655360` 到 `8294400` 之间。

## MCP Server

构建并启动 MCP：

```bash
npx pnpm@9.15.4 --filter @image-gen-web/mcp build
npx pnpm@9.15.4 --filter @image-gen-web/mcp start
```

MCP 客户端配置示例：

```json
{
  "mcpServers": {
    "image-gen-web": {
      "command": "node",
      "args": ["/absolute/path/to/image-gen-web/apps/mcp/dist/server.js"],
      "env": {
        "IMAGE_GEN_API_URL": "http://localhost:8700"
      }
    }
  }
}
```

## 安全提醒

- 不要提交 `.env`。
- 不要把真实 API Key 写进 README、前端代码或测试文件。
- 管理后台必须设置强密码。
- 如果管理后台暴露在公网，建议再加防火墙或反向代理访问控制。
- 日志会记录请求体和上游响应，适合排查问题；如果面向大量外部用户，应提前告知用户日志策略。
