# Multi Image Edit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable image-to-image requests to send multiple reference images to the configured `gpt-image-2` provider.

**Architecture:** Update shared app types only where necessary, change the web app from single file state to file array state, update API multipart parsing to collect images, and update provider adapter to append every image to the outgoing multipart request.

**Tech Stack:** React, Vite, TypeScript, Fastify, Multipart FormData, Vitest.

---

### Task 1: Add API Multi-Image Route Coverage

**Files:**
- Modify: `apps/api/src/routes/imageRoutes.test.ts`

**Step 1: Write failing test**

Add an API route test that posts multipart form data with two `image` files and verifies the mocked provider receives two images.

**Step 2: Run failing test**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/api test`

Expected: FAIL because the app only keeps one image.

### Task 2: Implement API Multi-Image Parsing

**Files:**
- Modify: `apps/api/src/app.ts`

**Step 1: Implement minimal code**

Change `ImageProvider.edit` to receive `images: UploadedImage[]`. Increase multipart `files` limit to 10. Collect every file part into an array and require at least one image.

**Step 2: Verify API**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/api test`

Expected: PASS.

### Task 3: Add Provider Multi-Image Coverage

**Files:**
- Modify: `apps/api/src/provider/openaiImageProvider.test.ts`
- Modify: `apps/api/src/provider/openaiImageProvider.ts`

**Step 1: Write failing provider test**

Mock global fetch, call `editOpenAIImage` with two image buffers, inspect outgoing `FormData`, and verify it contains two `image` entries.

**Step 2: Run failing test**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/api test`

Expected: FAIL because provider accepts one image.

**Step 3: Implement provider update**

Change `editOpenAIImage` to accept an image array and append each image with `form.append('image', ...)`.

**Step 4: Verify API**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/api test`

Expected: PASS.

### Task 4: Add Web Multi-Image UI Coverage

**Files:**
- Modify: `apps/web/src/App.test.tsx`

**Step 1: Write failing web tests**

Add tests that the reference image input has `multiple`, selected file names render, and image-to-image request appends multiple image fields.

**Step 2: Run failing test**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/web test`

Expected: FAIL because the UI supports one file.

### Task 5: Implement Web Multi-Image UI

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/styles.css`

**Step 1: Implement minimal code**

Change `image` state to `images: File[]`, add `multiple` to the file input, display selected filenames, require at least one image, and append every image in `editImage`.

**Step 2: Verify web**

Run: `npx pnpm@9.15.4 --filter @image-gen-web/web test`

Expected: PASS.

### Task 6: Final Verification

**Files:**
- Modify: `README.md`

**Step 1: Document multi-image edit**

Update README to mention up to 10 reference images in image-to-image mode.

**Step 2: Run full verification**

Run:

```bash
npx pnpm@9.15.4 typecheck
npx pnpm@9.15.4 test
npx pnpm@9.15.4 build
```

Expected: all commands pass.
