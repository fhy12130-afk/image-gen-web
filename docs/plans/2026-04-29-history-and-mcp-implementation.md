# History and MCP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist generated images locally, show them in web history, and expose generation/editing tools through an MCP server.

**Architecture:** The Fastify API becomes the source of truth for generated image files and history metadata. The web app consumes API history endpoints, and the MCP server is a separate workspace package that calls the local API instead of talking to the image provider directly.

**Tech Stack:** TypeScript, Fastify, React, Vite, Vitest, Zod, MCP TypeScript SDK, Node file system APIs.

---

### Task 1: Add Shared History Contracts

**Files:**
- Modify: `packages/shared/src/contracts.ts`
- Modify: `packages/shared/src/contracts.test.ts`

**Step 1: Write failing tests**

Add tests for history image and record schemas in `packages/shared/src/contracts.test.ts`:

```ts
it('accepts image history records', () => {
  const parsed = imageHistoryRecordSchema.parse({
    id: 'hist_abc',
    createdAt: '2026-04-29T00:00:00.000Z',
    mode: 'text',
    prompt: 'a fox',
    model: 'gpt-image-2',
    size: '1024x1024',
    durationMs: 123,
    images: [
      {
        id: 'img_abc',
        fileName: 'img_abc.png',
        mimeType: 'image/png',
        bytes: 12,
        url: '/api/history/image/img_abc.png',
        downloadUrl: '/api/history/image/img_abc.png?download=1'
      }
    ]
  });

  expect(parsed.id).toBe('hist_abc');
});
```

**Step 2: Verify RED**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/shared test`

Expected: FAIL because `imageHistoryRecordSchema` does not exist.

**Step 3: Implement contracts**

Add Zod schemas and types:

```ts
export const imageHistoryModeSchema = z.enum(['text', 'image']);

export const imageHistoryImageSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  url: z.string().min(1),
  downloadUrl: z.string().min(1),
  sourceUrl: z.string().url().optional()
});

export const imageHistoryRecordSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  mode: imageHistoryModeSchema,
  prompt: z.string().min(1),
  model: z.string().min(1),
  size: imageSizeSchema,
  durationMs: z.number().nonnegative(),
  images: z.array(imageHistoryImageSchema).min(1)
});

export const imageHistoryResponseSchema = z.object({
  records: z.array(imageHistoryRecordSchema)
});

export type ImageHistoryRecord = z.infer<typeof imageHistoryRecordSchema>;
export type ImageHistoryImage = z.infer<typeof imageHistoryImageSchema>;
export type ImageHistoryResponse = z.infer<typeof imageHistoryResponseSchema>;
```

Extend `imageResponseSchema` with optional history:

```ts
history: imageHistoryRecordSchema.optional()
```

**Step 4: Verify GREEN**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/shared test`

Expected: PASS.

---

### Task 2: Implement API History Store

**Files:**
- Create: `apps/api/src/historyStore.ts`
- Create: `apps/api/src/historyStore.test.ts`

**Step 1: Write failing tests**

Test that URL and base64 provider images are persisted:

```ts
it('saves base64 images and appends a history record', async () => {
  const store = createHistoryStore({ dataDir: tempDir, publicBaseUrl: 'http://localhost:8787' });
  const record = await store.saveGeneration({
    mode: 'text',
    prompt: 'a fox',
    model: 'gpt-image-2',
    size: '1024x1024',
    durationMs: 10,
    images: [{ url: null, b64Json: Buffer.from('png').toString('base64') }]
  });

  expect(record.images[0].fileName).toMatch(/\.png$/);
  expect(await store.listHistory()).toHaveLength(1);
});
```

**Step 2: Verify RED**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/api test -- historyStore.test.ts`

Expected: FAIL because module does not exist.

**Step 3: Implement store**

Create a small store with:

- `createHistoryStore({ dataDir, publicBaseUrl })`
- `saveGeneration(input)`
- `listHistory()`
- `clearHistory()`
- `getImagePath(fileName)`

Use `node:fs/promises`, `node:path`, and `crypto.randomUUID()`. Save files to `${dataDir}/generated`. Save index to `${dataDir}/history.json`. Use atomic-ish writes by writing the complete JSON file after each append.

For URL images, call `fetch(image.url)`, read `content-type`, and save bytes. For base64, save PNG bytes by default.

**Step 4: Verify GREEN**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/api test -- historyStore.test.ts`

Expected: PASS.

---

### Task 3: Wire History Into API Routes

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/imageRoutes.test.ts`

**Step 1: Write failing route tests**

Add tests that successful generate/edit responses include `history`, and `GET /api/history` returns saved records.

**Step 2: Verify RED**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/api test -- imageRoutes.test.ts`

Expected: FAIL because response has no `history` and route does not exist.

**Step 3: Implement route wiring**

Update `buildApp` options to include a history store dependency. After provider success, call `historyStore.saveGeneration` with mode and metadata. Return:

```ts
return { images: generatedImages, durationMs, history };
```

Add routes:

- `GET /api/history`
- `GET /api/history/image/:fileName`
- `DELETE /api/history`

In `server.ts`, instantiate the real history store with `apps/api/data` and public base URL `http://localhost:${config.apiPort}`.

**Step 4: Verify GREEN**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/api test`

Expected: PASS.

---

### Task 4: Add Web History Client and UI

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/App.test.tsx`

**Step 1: Write failing web tests**

Add tests for:

- History loads from `/api/history` and renders thumbnail/prompt.
- After generation, history refreshes.
- Restore fills prompt/model/size and mode.

**Step 2: Verify RED**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/web test`

Expected: FAIL because history UI/client does not exist.

**Step 3: Implement client methods**

In `api.ts`, add:

- `fetchHistory()`
- `clearHistory()`

Parse with shared schemas.

**Step 4: Implement UI**

Add `historyRecords` state, load on mount, refresh after successful generation, render a History panel with thumbnail, prompt, metadata, Download, Restore, and Clear history.

**Step 5: Verify GREEN**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/web test`

Expected: PASS.

---

### Task 5: Add MCP Server Package

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `apps/mcp/package.json`
- Create: `apps/mcp/tsconfig.json`
- Create: `apps/mcp/src/server.ts`
- Create: `apps/mcp/src/server.test.ts`

**Step 1: Add dependency**

Run: `npx pnpm@9.15.4 add @modelcontextprotocol/sdk zod -F @image-gen-web/mcp`

If package does not exist yet, create `apps/mcp/package.json` first and then run install.

**Step 2: Write failing MCP tests**

Test that `generate_image` posts to `/api/image/generate` and returns history/image metadata. Mock `fetch`.

**Step 3: Verify RED**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/mcp test`

Expected: FAIL because server/tools do not exist.

**Step 4: Implement MCP tools**

Use MCP SDK stdio server. Implement tools:

- `generate_image`
- `edit_image`
- `list_image_history`
- `get_image_history_item`
- `get_image_generation_help`

Default API URL: `process.env.IMAGE_GEN_API_URL || 'http://localhost:8787'`.

For `edit_image`, read `imagePaths` with `node:fs/promises`, create `File` objects or multipart-compatible blobs, and call `/api/image/edit`.

**Step 5: Verify GREEN**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/mcp test`

Expected: PASS.

---

### Task 6: Document History and MCP Usage

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

**Step 1: Update docs**

Add sections:

- History storage path and behavior.
- History endpoints.
- MCP server build/start commands.
- Example MCP client config:

```json
{
  "mcpServers": {
    "image-gen-web": {
      "command": "node",
      "args": ["D:/code/image-gen-web/apps/mcp/dist/server.js"],
      "env": {
        "IMAGE_GEN_API_URL": "http://localhost:8787"
      }
    }
  }
}
```

**Step 2: Verify docs commands**

Run:

```bash
npx pnpm@9.15.4 typecheck
npx pnpm@9.15.4 test
npx pnpm@9.15.4 build
```

Expected: all PASS.

---

### Task 7: Final Manual Verification

**Files:**
- No code changes unless verification reveals a bug.

**Step 1: Start app**

Run: `start.bat`

**Step 2: Generate text image**

Expected: result appears, history card appears, local file exists in `apps/api/data/generated`.

**Step 3: Generate image edit**

Expected: result appears, history card appears, download works.

**Step 4: Run MCP server**

Build and run MCP server with a local MCP inspector/client. Call `get_image_generation_help`, `generate_image`, and `list_image_history`.

Expected: MCP returns saved image URLs and history IDs.

**Step 5: Final verification**

Run:

```bash
npx pnpm@9.15.4 typecheck
npx pnpm@9.15.4 test
npx pnpm@9.15.4 build
```

Expected: all PASS.
