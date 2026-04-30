# History and MCP Design

## Goal

Add persistent image generation history and expose the local image generator as an MCP server so external AI tools can generate and edit images through this project.

## Scope

- Save generated images locally after successful text-to-image and image-to-image requests.
- Store searchable generation metadata in a local JSON history index.
- Show history in the web UI with preview and download actions.
- Add an MCP server with tools that call the existing API and return saved image paths/URLs.
- Keep provider API keys server-side only.

## Persistence Model

The API owns persistence. On every successful generation/edit request, it writes generated image files under `apps/api/data/generated/` and appends a record to `apps/api/data/history.json`.

The history index stores:

- `id`: stable history record id.
- `createdAt`: ISO timestamp.
- `mode`: `text` or `image`.
- `prompt`, `model`, `size`, `durationMs`.
- `images`: generated image entries with id, file name, MIME type, byte size, preview URL, and download URL.
- `source`: optional provider URL metadata, but never API keys.

Generated images may be returned by the provider as URLs or base64. URL images are fetched by the API and copied locally. Base64 images are decoded directly. If local saving fails after the provider succeeds, the API should return a provider result plus a clear persistence error only if no local image could be saved. The first version should keep this simple: generation succeeds only when at least one image is saved.

## API Design

Existing web endpoints stay intact:

- `POST /api/image/generate`
- `POST /api/image/edit`
- `GET /api/image/download`

Their responses will be extended to include an optional `history` object while preserving `images` and `durationMs`.

New history endpoints:

- `GET /api/history`: returns latest history records, newest first.
- `GET /api/history/image/:fileName`: streams a locally saved image; `?download=1` adds attachment headers.
- `DELETE /api/history`: clears history index and generated image files.

New AI-readable endpoints are not required for MCP itself, but the API should return stable absolute URLs based on the request origin so MCP tools can return usable links.

## Web UI Design

The web app keeps the current generation workflow. A new History panel appears under or beside the Result panel. It loads history on page load and refreshes after each successful generation.

Each history card shows:

- Thumbnail.
- Prompt preview.
- Mode, model, size, creation time, duration.
- Download button per image.
- Restore button to fill prompt/model/size and switch mode.

The first version supports clearing all history. It does not need tagging, search, single-record deletion, pagination, or account separation.

## MCP Server Design

Add a separate MCP package/app that can be started locally and configured in MCP-capable clients. It talks to the existing API at `http://localhost:8787` by default.

Tools:

- `generate_image`
  - Input: `prompt`, optional `model`, optional `size`.
  - Calls `POST /api/image/generate`.
  - Returns history id, local image URLs, download URLs, and concise metadata.
- `edit_image`
  - Input: `prompt`, `imagePaths`, optional `model`, optional `size`.
  - Reads local reference image paths and sends multipart request to `POST /api/image/edit`.
  - Returns history id and generated image URLs.
- `list_image_history`
  - Input: optional `limit`.
  - Calls `GET /api/history`.
  - Returns recent records.
- `get_image_history_item`
  - Input: `historyId`.
  - Returns one history item from the list response.
- `get_image_generation_help`
  - Returns usage guidance, supported sizes, and examples.

The MCP server does not know the provider API key. It only calls the local API. This keeps secrets in `.env` and avoids exposing credentials to AI clients.

## Configuration

MCP package defaults:

- `IMAGE_GEN_API_URL=http://localhost:8787`

README will include configuration examples for MCP-capable clients using `node` to run the built MCP server.

## Testing Strategy

- Shared contracts: history response schemas.
- API unit tests: history storage, URL/base64 image saving, history endpoints.
- API route tests: generate/edit responses include history metadata.
- Web tests: history list renders, refreshes after generation, restore button fills fields.
- MCP tests: tools call expected API endpoints and format responses.
- Final verification: `npx pnpm@9.15.4 typecheck`, `npx pnpm@9.15.4 test`, `npx pnpm@9.15.4 build`.

## Out of Scope

- Public internet deployment.
- User login.
- Database server.
- Cloud object storage.
- Prompt search and tagging.
- Single-record deletion.
