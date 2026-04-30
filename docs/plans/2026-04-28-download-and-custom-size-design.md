# Download and Custom Size Design

## Goal

Improve the current image generation MVP with direct image download and flexible custom size input for the single `gpt-image-2` model workflow.

## Decisions

- Only support the current image model configured in `.env`, expected to be `gpt-image-2`.
- Keep the model input simple or remove user-facing model switching later; no multi-model selector is needed for this change.
- Support preset sizes and a custom size override.
- Add a reliable download button for generated images.

## Size Behavior

The public config endpoint should return these default size choices:

- `auto`
- `1024x1024`
- `1024x1536`
- `1536x1024`

The UI should also expose a custom size input. If the custom size input is filled, it overrides the selected preset. The custom value must be either `auto` or `WIDTHxHEIGHT`, such as `1280x720`.

The back-end should validate the same format and pass the selected size through to the provider. If the provider rejects a custom size, the app should show the provider error instead of hiding it.

## Download Behavior

Each generated image should show:

- `Open image` for URL-based results.
- `Download` for both URL-based results and base64 results.

For base64 results, the front-end can create a Blob and download directly.

For URL results, the front-end should call a back-end proxy endpoint:

```text
GET /api/image/download?url=<encoded-url>
```

The back-end downloads the remote image and returns it as an attachment. This avoids browser CORS issues and gives us a consistent filename.

## Safety and Validation

- The download endpoint should only allow `http:` and `https:` URLs.
- Invalid URLs should return `400 VALIDATION_ERROR`.
- Failed remote downloads should return `502 PROVIDER_ERROR`.
- The file extension should be inferred from `content-type`, falling back to `.png`.
- Custom size should be validated by shared schema.

## Testing

- Shared contract tests should verify `auto`, standard sizes, and custom `WIDTHxHEIGHT` values.
- API route tests should verify download success and invalid URL rejection.
- Web tests should verify the Download button renders for generated results and custom size overrides the preset.
