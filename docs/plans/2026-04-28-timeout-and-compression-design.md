# Timeout and Image Compression Design

## Goal

Make multi-image image-to-image generation more reliable by increasing long-running request timeouts and automatically compressing uploaded reference images before sending them to the API.

## Problem

Multi-image edit requests with large PNG files can take 4-5 minutes on the provider side. The current client/server chain can disconnect earlier, producing `fetch failed` while `new-api` eventually succeeds and logs `broken pipe` because the client has already disconnected.

## Design

### Longer Timeouts

- Add `IMAGE_API_TIMEOUT_MS` to environment config.
- Default to `900000` ms, or 15 minutes.
- Use `AbortController` for provider fetch calls.
- Include `timeoutMs` in provider diagnostics logs.
- Return a clear timeout message if the provider exceeds the configured timeout.
- Increase Vite proxy timeout for `/api` in development.
- Increase Fastify server request/socket timeout after listen.

### Browser Image Compression

When users select reference images in image-to-image mode:

- Decode each image in the browser.
- Resize it so the longest edge is no more than 2048px.
- Convert it to JPEG with quality `0.85`.
- Keep image names readable by changing extensions to `.jpg`.
- Store metadata for each selected image:
  - original file name
  - original bytes
  - compressed bytes
  - compression status
- Send compressed files to the API.
- If compression fails for a file, keep the original file and show that fallback in the UI.

### UI

The selected file list should show:

- File name.
- Original size.
- Compressed size.
- Status: compressed or original.

### Limits

- Keep max selected image count at 10.
- Keep API per-file limit at 60MB.
- Compression is best-effort; it should not block generation if one file fails to compress.

## Testing

- Unit test timeout config defaults and env override.
- Unit test provider timeout converts abort into a clear timeout error.
- Web test selected image compression metadata renders.
- Web test image-to-image sends compressed files.
