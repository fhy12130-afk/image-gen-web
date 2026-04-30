# Download and Custom Size Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add direct download and custom size support to the single-model `gpt-image-2` image generation app.

**Architecture:** Extend the shared size schema, return richer public config from the API, add a download proxy route, and update the React UI to support custom size override and per-image downloads.

**Tech Stack:** React, Vite, TypeScript, Fastify, Zod, Vitest.

---

### Task 1: Extend Size Contracts

**Files:**
- Modify: `packages/shared/src/contracts.ts`
- Modify: `packages/shared/src/contracts.test.ts`

**Step 1: Write failing tests**

Add tests that `imageGenerationRequestSchema` accepts `size: "auto"` and `size: "1280x720"`, while rejecting malformed values like `wide`.

**Step 2: Run failing test**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/shared test`

Expected: FAIL because `auto` is not accepted yet.

**Step 3: Implement schema update**

Update `imageSizeSchema` to accept `auto` or `WIDTHxHEIGHT`.

**Step 4: Verify**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/shared test`

Expected: PASS.

### Task 2: Add API Size Config and Download Route

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/imageRoutes.test.ts`

**Step 1: Write failing tests**

Add route tests for:

- `/api/config/public` includes `auto` in sizes.
- `/api/image/download?url=https://example.com/image.png` returns attachment content when fetch succeeds.
- `/api/image/download?url=file:///etc/passwd` returns `400 VALIDATION_ERROR`.

**Step 2: Run failing tests**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/api test`

Expected: FAIL because download route does not exist.

**Step 3: Implement API changes**

Return sizes `auto`, `1024x1024`, `1024x1536`, `1536x1024`. Add `GET /api/image/download` with URL validation, remote fetch, content-type handling, and attachment headers.

**Step 4: Verify**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/api test`

Expected: PASS.

### Task 3: Add UI Custom Size and Download

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/App.test.tsx`

**Step 1: Write failing tests**

Add tests that:

- A custom size input appears.
- Filling custom size causes the generation request to send that custom size.
- A generated result renders a `Download` action.

**Step 2: Run failing tests**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/web test`

Expected: FAIL because the UI does not have custom size or download yet.

**Step 3: Implement UI changes**

Add `customSize` state. Submit `customSize.trim() || size`. Add download helpers for URL and base64 images. Render a Download button for each result.

**Step 4: Verify**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/web test`

Expected: PASS.

### Task 4: Final Verification

**Files:**
- Modify: `README.md`

**Step 1: Document behavior**

Update README with custom size and download notes.

**Step 2: Run full verification**

Run:

```bash
npx pnpm@9.15.4 typecheck
npx pnpm@9.15.4 test
npx pnpm@9.15.4 build
```

Expected: all commands pass.
