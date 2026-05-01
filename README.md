# Image Gen Web

一个前后端分离的图片生成 Web 应用，用来连接 OpenAI 兼容的图片生成接口。它把 provider API Key 保存在服务端，浏览器只和本地 API 通信，适合自用部署、团队内网使用，也适合作为二次开发的开源基础项目。

## 功能特性

- 支持文生图，对应 OpenAI 兼容接口 `/images/generations`。
- 支持图生图和图片编辑，对应 OpenAI 兼容接口 `/images/edits`。
- 支持一次上传最多 10 张参考图。
- 浏览器端会先压缩参考图，降低上传体积和失败率。
- 支持 `auto`、1K、2K、4K 等常用尺寸预设。
- 支持自定义 `WIDTHxHEIGHT` 尺寸，并在前后端统一校验。
- 支持 `low`、`medium`、`high` 质量选项。
- 服务端图片任务队列，支持配置并发数和临时 provider 错误重试。
- 本地生成历史，支持预览、恢复参数、下载图片和清空记录。
- 内置 MCP stdio server，方便 Codex、Claude Desktop 等本地 AI 客户端调用。
- 支持 Docker 一条命令启动。
- API Key 只保存在服务端，不暴露给浏览器。

## 项目结构

```text
apps/web           React + Vite 前端
apps/api           Fastify API 服务
apps/mcp           MCP stdio server，调用本地 API
packages/shared    前后端和 MCP 共用的 TypeScript 协议
docs/plans         设计和实现记录
scripts            启动脚本相关测试
```

## Docker 启动

在项目根目录执行：

```powershell
copy .env.example .env
notepad .env
docker compose up --build
```

也可以直接双击：

```text
docker-start.bat
```

服务地址：

```text
Web: http://localhost:5173
API: http://localhost:8700
```

生成历史会持久化到 Docker volume：

```text
image-gen-web_api-data
```

如果 Docker 无法从 Docker Hub 拉取 `node:20-bookworm-slim`，可以在 `.env` 里把 `DOCKER_NODE_IMAGE` 改成你信任的 Node 20 镜像源，例如：

```env
DOCKER_NODE_IMAGE=docker.m.daocloud.io/library/node:20-bookworm-slim
```

然后重新运行 Docker 启动命令。

## 本地启动

不使用 Docker 时，可以直接用 pnpm 启动：

```bash
npx pnpm@9.15.4 install
npx pnpm@9.15.4 dev
```

Windows 一键启动脚本：

```text
start.bat
start.ps1
```

## 环境变量

调用真实 provider 前，请先复制并编辑 `.env`：

```env
IMAGE_API_BASE_URL=https://your-image-api.example.com/v1
IMAGE_API_KEY=sk-xxxx
DEFAULT_IMAGE_MODEL=gptimage2
IMAGE_API_COMPAT=openai
IMAGE_API_TIMEOUT_MS=900000
IMAGE_API_MAX_RETRIES=2
IMAGE_API_RETRY_DELAY_MS=8000
MAX_PARALLEL_IMAGE_JOBS=2
API_PORT=8700
WEB_ORIGIN=http://localhost:5173
IMAGE_GEN_API_URL=http://localhost:8700
```

`IMAGE_API_BASE_URL` 填基础 API 地址即可，不要把 API Key 写进前端代码。下面两种写法都会被服务端归一化：

```env
IMAGE_API_BASE_URL=https://www.example.com/v1
IMAGE_API_BASE_URL=https://www.example.com/v1/images/generations
```

## 图片尺寸

内置尺寸：

- `auto`
- `1024x1024`
- `1536x1024`
- `1024x1536`
- `2048x2048`
- `2048x1152`
- `3840x2160`
- `2160x3840`

自定义尺寸规则：

- 必须使用 `WIDTHxHEIGHT` 格式。
- 宽和高都不能超过 `3840`。
- 宽和高都必须是 `16` 的倍数。
- 长宽比不能超过 `3:1`。
- 总像素必须在 `655360` 到 `8294400` 之间。

## 图片质量

前端和 API 都支持以下质量：

- `low`
- `medium`
- `high`

默认值是 `medium`。文生图和图生图请求都会把该值作为 `quality` 传给 provider。

## 并发任务

前端提交图片请求后，任务会进入服务端内存队列。你可以继续添加提示词，旧任务会按队列状态展示为：

- `queued`
- `running`
- `succeeded`
- `failed`

默认并发数是 `2`：

```env
MAX_PARALLEL_IMAGE_JOBS=2
```

如果你的 provider 可以承受更高并发，可以把它调到 `5` 或更高。网络瞬断、HTTP `429`、HTTP `5xx` 等临时错误会自动重试：

```env
IMAGE_API_MAX_RETRIES=2
IMAGE_API_RETRY_DELAY_MS=8000
```

失败的内存任务在 API 服务仍运行时可以直接点击 `Retry` 重试。清空完成任务不会删除已保存的历史图片。

## 生成历史

API 会把成功生成的图片保存到本地：

```text
apps/api/data/generated
apps/api/data/history.json
```

历史接口：

- `GET /api/history`
- `DELETE /api/history`
- `GET /api/history/image/:fileName`
- `GET /api/history/image/:fileName?download=1`

## MCP Server

MCP 服务只调用本地 API，不接收也不知道 provider API Key。

构建并启动：

```bash
npx pnpm@9.15.4 --filter @image-gen-web/mcp build
npx pnpm@9.15.4 --filter @image-gen-web/mcp start
```

可用 MCP 工具：

- `generate_image`
- `edit_image`
- `queue_image_generation`
- `queue_image_edit`
- `list_image_jobs`
- `get_image_job`
- `retry_image_job`
- `list_image_history`
- `get_image_history_item`
- `get_image_generation_help`

如果要从 Codex 或其他 MCP 客户端并行生成图片，推荐优先使用 `queue_image_generation` 或 `queue_image_edit`，再用 `list_image_jobs` 或 `get_image_job` 轮询直到任务变成 `succeeded`。完成后的 job 会包含保存后的图片 URL 和下载 URL。

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

请把 `args` 中的路径替换成你本机实际路径。

## 常用脚本

- `pnpm dev`：启动 Web 和 API。
- `pnpm mcp:dev`：从源码启动 MCP server。
- `pnpm mcp:start`：启动构建后的 MCP server。
- `pnpm typecheck`：检查 TypeScript 类型。
- `pnpm test`：运行测试。
- `pnpm build`：构建所有 workspace 包。

## 开源发布前检查

推荐在提交或发布前运行：

```bash
npx pnpm@9.15.4 test
npx pnpm@9.15.4 typecheck
npx pnpm@9.15.4 build
```

## 安全说明

- 不要提交 `.env`，只提交 `.env.example`。
- 不要把 provider API Key 写入前端代码。
- 生产环境建议把 API 放在反向代理后，并按需限制访问来源。
- 本项目默认把生成图片保存在本地文件系统，请根据实际部署环境做好磁盘容量和备份策略。

## 常见问题

- 页面提示无法加载配置：确认 API 服务正在 `http://localhost:8700` 运行。
- provider 请求失败：检查 `IMAGE_API_BASE_URL`、`IMAGE_API_KEY` 和 `DEFAULT_IMAGE_MODEL`。
- 图生图失败：确认 provider 支持 `/images/edits` 和 multipart 图片上传。
- Docker 启动后生成失败：执行 `docker compose logs -f` 查看 provider 错误。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
