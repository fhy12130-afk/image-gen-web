# Image Generation Web Design

## Goal

Build a small front-end/back-end separated website that can call a configurable image generation API by URL and model name. The first version focuses on a reliable MVP for text-to-image and image-to-image workflows using an OpenAI-compatible image API shape.

## Reference Projects

- LibreChat: use its custom endpoint and configurable model idea, especially for OpenAI-compatible providers.
- Open WebUI: use its image generation/editing workflow as product inspiration.
- NextChat: use its lightweight configuration style as a reminder to keep the first version simple.

The project should not copy their large platform architecture. It should stay focused on one job: call a configured image generation service and show the result.

## Recommended Architecture

Use a monorepo with separated front-end and back-end apps.

```text
D:\code\image-gen-web
  apps
    web        # React + Vite + TypeScript
    api        # Fastify + TypeScript
  packages
    shared     # Shared request/response types
  docs
    plans
  .env.example
  package.json
  pnpm-workspace.yaml
  README.md
```

The browser never calls the image model provider directly. The front-end sends requests to the local API service, and the API service calls the configured image provider with the server-side API key.

## Tech Stack

### Front-end

- React 18 or newer
- Vite
- TypeScript
- CSS modules or plain CSS variables for the first version
- Fetch API for requests

### Back-end

- Node.js 20+
- Fastify
- TypeScript
- Zod for request validation
- Multipart support for image upload
- Native `fetch` and `FormData` for provider calls

### Tooling

- pnpm workspace
- Vitest for shared/API unit tests
- ESLint and TypeScript checks

## MVP Scope

### In Scope

- Text-to-image form with prompt, model, size, and image count.
- Image-to-image/edit form with uploaded image, prompt, model, and size.
- Server-side provider configuration through `.env`.
- Result preview for generated images.
- Copy image URL and download image actions when a URL is returned.
- Clear error messages for missing config, invalid input, provider errors, and unsupported responses.

### Out of Scope

- User login.
- Billing or quota management.
- Prompt history database.
- Gallery persistence.
- Multiple provider marketplace.
- Complex workflow nodes like ComfyUI.

## Configuration

The API service reads sensitive configuration from `.env`.

```env
IMAGE_API_BASE_URL=https://your-image-api.example.com/v1
IMAGE_API_KEY=sk-xxxx
DEFAULT_IMAGE_MODEL=gptimage2
IMAGE_API_COMPAT=openai
API_PORT=8787
WEB_ORIGIN=http://localhost:5173
```

The first compatibility target is OpenAI-style image endpoints:

- `POST /images/generations` for text-to-image.
- `POST /images/edits` for image-to-image/edit.

If the provider uses a different format, add a provider adapter later instead of leaking provider details into the front-end.

## API Design

### `GET /api/config/public`

Returns safe public configuration for the UI.

```json
{
  "defaultModel": "gptimage2",
  "sizes": ["1024x1024", "1024x1536", "1536x1024"],
  "supportsImageEdit": true
}
```

### `POST /api/image/generate`

Text-to-image request.

```json
{
  "prompt": "a cinematic cat portrait",
  "model": "gptimage2",
  "size": "1024x1024",
  "n": 1
}
```

Response:

```json
{
  "images": [
    {
      "url": "https://...",
      "b64Json": null
    }
  ],
  "durationMs": 1200
}
```

### `POST /api/image/edit`

Multipart request.

- `image`: uploaded image file
- `prompt`: edit instruction
- `model`: model name
- `size`: output size

Response shape matches `/api/image/generate`.

## Data Flow

1. User fills the form in the web app.
2. Web app validates basic required fields.
3. Web app sends a request to the API service.
4. API service validates the request using Zod.
5. API service calls the configured image provider.
6. API service normalizes the provider response into `{ images, durationMs }`.
7. Web app renders the result or a friendly error.

## Error Handling

The API service should normalize errors into this shape:

```json
{
  "error": {
    "code": "PROVIDER_ERROR",
    "message": "Image provider rejected the request.",
    "details": "model not found"
  }
}
```

Initial error codes:

- `CONFIG_MISSING`
- `VALIDATION_ERROR`
- `PROVIDER_UNREACHABLE`
- `PROVIDER_ERROR`
- `UNSUPPORTED_PROVIDER_RESPONSE`

## UI Direction

The UI should feel like a focused image-generation workbench, not a generic chat clone.

- Left side: generation controls.
- Right side: result preview and status.
- Top: simple title and provider status.
- Use a warm studio-like visual theme with CSS variables, subtle gradients, and responsive layout.
- Mobile layout stacks controls above results.

## Testing Strategy

- Unit test request validation schemas.
- Unit test OpenAI-compatible response normalization.
- Unit test provider URL construction.
- Add a mocked API route test for successful generation.
- Add a mocked API route test for provider error normalization.
- Manually verify browser flows with local dev servers.

## Success Criteria

- `pnpm install` installs all workspace dependencies.
- `pnpm dev` starts both web and API services.
- Text-to-image sends a request through the API service and displays an image result.
- Image-to-image accepts an uploaded file and displays an image result.
- API keys are never exposed to the browser.
- User-facing errors are understandable.
