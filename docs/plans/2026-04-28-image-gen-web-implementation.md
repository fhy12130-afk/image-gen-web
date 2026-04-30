# Image Generation Web Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a front-end/back-end separated MVP website that calls a configurable image generation API by URL and model name.

**Architecture:** Use a pnpm monorepo with `apps/web` for React/Vite and `apps/api` for Fastify. The web app calls the API app, and the API app calls an OpenAI-compatible image provider using server-side configuration.

**Tech Stack:** React, Vite, TypeScript, Fastify, Zod, Vitest, pnpm workspaces.

---

### Task 1: Create Workspace Skeleton

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`
- Create: `apps/web/package.json`
- Create: `apps/api/package.json`
- Create: `packages/shared/package.json`

**Step 1: Create root workspace files**

Create `package.json`:

```json
{
  "name": "image-gen-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "pnpm --parallel --filter @image-gen-web/api --filter @image-gen-web/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `.gitignore`:

```gitignore
node_modules
dist
.env
.env.local
coverage
*.log
```

Create `.env.example`:

```env
IMAGE_API_BASE_URL=https://your-image-api.example.com/v1
IMAGE_API_KEY=sk-xxxx
DEFAULT_IMAGE_MODEL=gptimage2
IMAGE_API_COMPAT=openai
API_PORT=8787
WEB_ORIGIN=http://localhost:5173
```

Create `README.md` with project goal, setup commands, and env instructions.

**Step 2: Create app package files**

Create `apps/api/package.json`:

```json
{
  "name": "@image-gen-web/api",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.0",
    "@fastify/multipart": "^9.0.0",
    "@image-gen-web/shared": "workspace:*",
    "fastify": "^5.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "vitest": "^2.1.0"
  }
}
```

Create `apps/web/package.json`:

```json
{
  "name": "@image-gen-web/web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "typecheck": "tsc -b --noEmit"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "typescript": "^5.8.0",
    "vitest": "^2.1.0"
  }
}
```

Create `packages/shared/package.json`:

```json
{
  "name": "@image-gen-web/shared",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

**Step 3: Install dependencies**

Run: `pnpm install`

Expected: dependencies install successfully and `pnpm-lock.yaml` is created.

**Step 4: Commit**

```bash
git add .
git commit -m "chore: scaffold image generation workspace"
```

Skip commit if the folder is not initialized as a git repository.

### Task 2: Add Shared API Types and Validation Contracts

**Files:**
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/contracts.ts`
- Test: `packages/shared/src/contracts.test.ts`

**Step 1: Write failing tests**

Create `packages/shared/src/contracts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { imageGenerationRequestSchema } from './contracts';

describe('imageGenerationRequestSchema', () => {
  it('accepts a minimal valid generation request', () => {
    const result = imageGenerationRequestSchema.parse({
      prompt: 'a neon fox',
      model: 'gptimage2',
      size: '1024x1024',
      n: 1
    });

    expect(result.prompt).toBe('a neon fox');
  });

  it('rejects an empty prompt', () => {
    expect(() =>
      imageGenerationRequestSchema.parse({
        prompt: '',
        model: 'gptimage2',
        size: '1024x1024',
        n: 1
      })
    ).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @image-gen-web/shared test`

Expected: FAIL because contracts do not exist.

**Step 3: Implement shared contracts**

Create `packages/shared/tsconfig.json` and contract files. Export Zod schemas and inferred types for config, generation request, image result, and API error.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @image-gen-web/shared test`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat: add shared image API contracts"
```

### Task 3: Implement Provider Adapter

**Files:**
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/provider/openaiImageProvider.ts`
- Test: `apps/api/src/provider/openaiImageProvider.test.ts`

**Step 1: Write failing tests**

Test URL joining and response normalization:

```ts
import { describe, expect, it } from 'vitest';
import { buildProviderUrl, normalizeOpenAIImageResponse } from './openaiImageProvider';

describe('buildProviderUrl', () => {
  it('joins base URL and path without duplicate slashes', () => {
    expect(buildProviderUrl('https://api.example.com/v1/', '/images/generations')).toBe(
      'https://api.example.com/v1/images/generations'
    );
  });
});

describe('normalizeOpenAIImageResponse', () => {
  it('normalizes url image responses', () => {
    expect(
      normalizeOpenAIImageResponse({ data: [{ url: 'https://cdn.example.com/a.png' }] })
    ).toEqual([{ url: 'https://cdn.example.com/a.png', b64Json: null }]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @image-gen-web/api test`

Expected: FAIL because provider module does not exist.

**Step 3: Implement provider helpers**

Implement URL joining, response normalization for `url` and `b64_json`, and provider error class.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @image-gen-web/api test`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add OpenAI-compatible image provider adapter"
```

### Task 4: Implement API Server Routes

**Files:**
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/errors.ts`
- Create: `apps/api/src/routes/configRoutes.ts`
- Create: `apps/api/src/routes/imageRoutes.ts`
- Create: `apps/api/src/server.ts`
- Test: `apps/api/src/routes/imageRoutes.test.ts`

**Step 1: Write failing route tests**

Use Fastify injection with a mocked provider to verify:

- `GET /api/config/public` returns default model and sizes.
- `POST /api/image/generate` validates prompt and returns normalized images.
- Provider errors become normalized API errors.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @image-gen-web/api test`

Expected: FAIL because routes do not exist.

**Step 3: Implement routes**

Create Fastify app with CORS, multipart support, config loading, image generation route, image edit route, and normalized errors.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @image-gen-web/api test`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add image generation API routes"
```

### Task 5: Build Front-end App Shell

**Files:**
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.node.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/styles.css`

**Step 1: Create Vite React app files**

Implement a two-panel responsive layout with mode switch, prompt textarea, model input, size select, upload field for edit mode, submit button, status area, and result preview.

**Step 2: Add API client helpers**

Create front-end functions for:

- `fetchPublicConfig()`
- `generateImage()`
- `editImage()`

**Step 3: Run typecheck**

Run: `pnpm --filter @image-gen-web/web typecheck`

Expected: PASS.

**Step 4: Run build**

Run: `pnpm --filter @image-gen-web/web build`

Expected: PASS and Vite emits `dist`.

**Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add image generation web UI"
```

### Task 6: Wire End-to-End Dev Flow

**Files:**
- Modify: `README.md`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/api/src/server.ts`

**Step 1: Configure local proxy**

Set Vite dev server proxy from `/api` to `http://localhost:8787`.

**Step 2: Verify startup**

Run: `pnpm dev`

Expected:

- API starts on `http://localhost:8787`.
- Web starts on `http://localhost:5173`.

**Step 3: Verify mock or real provider path**

If no real provider key is available, document how to use a temporary mock response mode. If key is available, verify one text-to-image request manually.

**Step 4: Run full checks**

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: all commands pass.

**Step 5: Commit**

```bash
git add .
git commit -m "docs: document local image generation workflow"
```
