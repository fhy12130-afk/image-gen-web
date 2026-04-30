# Multi Image Edit Design

## Goal

Allow image-to-image generation to accept multiple reference images so the image model can understand several visual inputs in one edit request.

## Current State

- The web app stores one `File | null` for image-to-image mode.
- The file input accepts one image.
- The API client sends one multipart `image` field.
- The API service accepts one file because multipart is limited to `files: 1`.
- The OpenAI-compatible provider adapter sends one `image` field to `/images/edits`.

## Target Behavior

- Image-to-image mode supports selecting multiple files at once.
- The UI shows the selected image count and filenames.
- The request fails before provider call if no image is selected.
- The API accepts up to 10 images.
- The provider adapter repeats the multipart field name `image` for each reference image.

## Multipart Format

The front-end should send multipart data like:

```text
prompt = "use these references to generate ..."
model = "gpt-image-2"
size = "1024x1024"
image = first.png
image = second.png
image = third.png
```

The back-end forwards the same repeated `image` field pattern to the provider.

## Validation

- Minimum images: 1 for image-to-image mode.
- Maximum images: 10.
- Accepted MIME types: `image/png`, `image/jpeg`, `image/webp`.
- Per-file size remains 10MB.
- If the upstream provider rejects multi-image edit, surface the provider error to the UI.

## Testing

- Web tests verify the file input supports `multiple` and selected filenames render.
- API route tests verify multiple multipart files are passed to provider.
- Provider tests verify multiple image files produce repeated `image` multipart fields.
