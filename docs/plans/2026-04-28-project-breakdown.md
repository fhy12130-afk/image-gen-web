# Image Generation Web Project Breakdown

## Overall Goal

Build a simple image generation website that lets the user configure a model API URL and model name, then generate images through text-to-image or image-to-image workflows.

The whole system is split into several small projects so each part can be built and verified independently.

## Project 1: Workspace and Foundation

### Purpose

Create the base monorepo structure and development workflow.

### Deliverables

- `pnpm` workspace.
- Root scripts for dev, build, test, and typecheck.
- Shared TypeScript setup.
- `.env.example` with required provider configuration.
- Basic README.

### Done When

- `pnpm install` succeeds.
- Root workspace can run scripts against all subprojects.
- Folder structure is ready for front-end, back-end, and shared packages.

## Project 2: Shared API Contract Package

### Purpose

Define the data contracts used by both front-end and back-end.

### Deliverables

- Request types for text-to-image.
- Request metadata for image-to-image.
- Response type for generated images.
- Public config type.
- Normalized error type.
- Zod validation schemas.

### Done When

- Shared package builds successfully.
- Contract tests pass.
- API and web projects can import shared types.

## Project 3: Back-end API Service

### Purpose

Provide a safe server-side proxy between the browser and the image generation provider.

### Deliverables

- Fastify server.
- Environment config loader.
- `GET /api/config/public`.
- `POST /api/image/generate`.
- `POST /api/image/edit`.
- Multipart image upload handling.
- OpenAI-compatible provider adapter.
- Unified error handling.

### Done When

- API starts on `http://localhost:8787`.
- API key stays server-side.
- Mocked route tests pass.
- Provider response is normalized for the front-end.

## Project 4: Front-end Web App

### Purpose

Create the user-facing image generation workbench.

### Deliverables

- React/Vite app.
- Text-to-image mode.
- Image-to-image mode.
- Prompt input.
- Model input.
- Size selector.
- Image upload field.
- Loading and error states.
- Result preview.
- Copy/download actions.

### Done When

- Web app starts on `http://localhost:5173`.
- User can switch between text-to-image and image-to-image.
- UI calls the back-end API rather than the provider directly.
- Build and typecheck pass.

## Project 5: Local Integration and Developer Experience

### Purpose

Make the whole system easy to run locally.

### Deliverables

- Vite proxy for `/api` requests.
- Root `pnpm dev` starts web and API together.
- README setup guide.
- Troubleshooting section.
- Optional mock provider mode if no real API key is available.

### Done When

- One command starts both services.
- A new developer can configure `.env` from `.env.example`.
- Text-to-image can be manually verified with a real or mocked provider.

## Project 6: MVP Hardening

### Purpose

Polish the first usable version so it is stable enough for regular use.

### Deliverables

- Better validation messages.
- Provider timeout handling.
- Request duration display.
- File size/type checks for uploaded images.
- Empty state and failure state UI.
- Full test/typecheck/build verification.

### Done When

- Invalid inputs fail before provider call.
- Provider failures show understandable messages.
- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.

## Execution Order

1. Build Project 1 first because all other projects depend on workspace setup.
2. Build Project 2 next so contracts are stable before API and UI work.
3. Build Project 3 before the UI so the front-end has real endpoints to call.
4. Build Project 4 after the API routes exist.
5. Build Project 5 to connect both apps into a smooth local workflow.
6. Build Project 6 after the end-to-end flow works.

## MVP Milestones

### Milestone 1: Empty Project Runs

- Workspace exists.
- Install works.
- Placeholder API and web apps compile.

### Milestone 2: API Can Generate by Prompt

- API reads provider config.
- API calls configured `/images/generations` endpoint.
- API returns normalized image results.

### Milestone 3: Web Can Generate by Prompt

- User enters prompt and model.
- Web calls API.
- Generated image appears in browser.

### Milestone 4: Image-to-Image Works

- User uploads image.
- Web sends multipart request.
- API calls configured `/images/edits` endpoint.
- Edited/generated image appears in browser.

### Milestone 5: First Usable MVP

- Errors are understandable.
- Loading state is clear.
- Basic docs are complete.
- Full verification passes.
