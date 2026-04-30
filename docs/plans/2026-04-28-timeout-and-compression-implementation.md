# Timeout and Image Compression Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce image-to-image failures by extending provider request timeouts and compressing large reference images before upload.

**Architecture:** Add timeout configuration in the API config and provider fetch layer. Add browser-side compression utilities in the web app, store image metadata, and send compressed files through the existing multipart flow.

**Tech Stack:** React, Vite, TypeScript, Fastify, native Canvas APIs, AbortController, Vitest.

---

### Task 1: Add API Timeout Config

**Files:**
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `.env.example`

**Step 1: Write failing tests**

Add config tests for default `imageApiTimeoutMs = 900000` and env override.

**Step 2: Run failing test**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/api test`

Expected: FAIL until config field exists.

**Step 3: Implement config**

Add `imageApiTimeoutMs` to `ApiConfig` and parse `IMAGE_API_TIMEOUT_MS`.

**Step 4: Verify**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/api test`


### Task 2: Add Provider Fetch Timeout

**Files:**
- Modify: `apps/api/src/provider/openaiImageProvider.ts`
- Modify: `apps/api/src/provider/openaiImageProvider.test.ts`
- Modify: `apps/api/src/server.ts`

**Step 1: Write failing tests**

Add a provider test that simulates an aborted fetch and expects an error containing configured timeout information.

**Step 2: Implement timeout**

Pass `timeoutMs` into provider config. Use `AbortController` and clear timers in finally. Log `timeoutMs` in diagnostics.

**Step 3: Verify**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/api test`


### Task 3: Increase Dev Proxy and Server Timeouts

**Files:**
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/api/src/server.ts`

**Step 1: Implement timeout tuning**

Set Vite proxy `timeout` and `proxyTimeout` to 15 minutes. Set Fastify underlying Node server timeouts after startup.

**Step 2: Verify typecheck**

Run: `npx pnpm@9.15.4 typecheck`


### Task 4: Add Browser Compression Utility

**Files:**
- Create: `apps/web/src/imageCompression.ts`
- Create: `apps/web/src/imageCompression.test.ts`

**Step 1: Write tests**

Test pure helpers such as `formatBytes`, `toCompressedFileName`, and metadata formatting. For Canvas behavior, keep logic small and use fallback tests where jsdom lacks image decoding.

**Step 2: Implement utility**

Export `compressImageFile(file)` returning `{ file, originalName, originalBytes, compressedBytes, status }`.


### Task 5: Wire Compression Into UI

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

**Step 1: Write failing UI tests**

Verify selected images show compression metadata and image-to-image request sends compressed files.

**Step 2: Implement UI state**

Store selected reference images as compression records. Show original and compressed sizes. Submit the compressed `file` values.

**Step 3: Verify web tests**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/web test`


### Task 6: Final Verification

**Files:**
- Modify: `README.md`

**Step 1: Document timeout and compression**

Explain `IMAGE_API_TIMEOUT_MS` and browser-side compression.

**Step 2: Run full verification**

Run:

```bash
npx pnpm@9.15.4 typecheck
npx pnpm@9.15.4 test
npx pnpm@9.15.4 build
```

Expected: all pass.
