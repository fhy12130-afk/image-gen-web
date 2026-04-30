import { z } from 'zod';

export const DEFAULT_IMAGE_SIZE = 'auto';
export const IMAGE_SIZE_OPTIONS = [
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x2048',
  '2048x1152',
  '3840x2160',
  '2160x3840'
] as const;

export const DEFAULT_IMAGE_QUALITY = 'medium';
export const IMAGE_QUALITY_OPTIONS = ['low', 'medium', 'high'] as const;

const MIN_CUSTOM_PIXELS = 655_360;
const MAX_CUSTOM_PIXELS = 8_294_400;
const MAX_CUSTOM_SIDE = 3840;
const MAX_CUSTOM_RATIO = 3;

export const imageSizeSchema = z.string().min(3).superRefine((value, context) => {
  if (value === 'auto') {
    return;
  }

  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Size must be auto or use WIDTHxHEIGHT format' });
    return;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  const longerSide = Math.max(width, height);
  const shorterSide = Math.min(width, height);

  if (longerSide > MAX_CUSTOM_SIDE) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Width and height must be 3840 px or smaller' });
  }

  if (width % 16 !== 0 || height % 16 !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Width and height must be multiples of 16' });
  }

  if (pixels < MIN_CUSTOM_PIXELS || pixels > MAX_CUSTOM_PIXELS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Total pixels must be between 655360 and 8294400'
    });
  }

  if (longerSide / shorterSide > MAX_CUSTOM_RATIO) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Aspect ratio must be 3:1 or smaller' });
  }
});

export const imageQualitySchema = z.enum(IMAGE_QUALITY_OPTIONS);

export const imageGenerationRequestSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt is required'),
  model: z.string().trim().min(1, 'Model is required'),
  size: imageSizeSchema,
  quality: imageQualitySchema.default(DEFAULT_IMAGE_QUALITY),
  n: z.number().int().min(1).max(4).default(1)
});

export const imageEditFieldsSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt is required'),
  model: z.string().trim().min(1, 'Model is required'),
  size: imageSizeSchema,
  quality: imageQualitySchema.default(DEFAULT_IMAGE_QUALITY)
});

export const generatedImageSchema = z.object({
  url: z.string().url().nullable(),
  b64Json: z.string().nullable()
});

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
  quality: imageQualitySchema.optional(),
  durationMs: z.number().nonnegative(),
  images: z.array(imageHistoryImageSchema).min(1)
});

export const imageHistoryResponseSchema = z.object({
  records: z.array(imageHistoryRecordSchema)
});

export const imageJobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed']);

export const imageJobRecordSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: imageJobStatusSchema,
  mode: imageHistoryModeSchema,
  prompt: z.string().min(1),
  model: z.string().min(1),
  size: imageSizeSchema,
  quality: imageQualitySchema,
  imageCount: z.number().int().nonnegative(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  durationMs: z.number().nonnegative().optional(),
  history: imageHistoryRecordSchema.optional(),
  error: z.string().optional()
});

export const imageJobResponseSchema = z.object({
  job: imageJobRecordSchema
});

export const imageJobsResponseSchema = z.object({
  jobs: z.array(imageJobRecordSchema),
  maxParallel: z.number().int().positive(),
  runningCount: z.number().int().nonnegative(),
  queuedCount: z.number().int().nonnegative()
});

export const imageResponseSchema = z.object({
  images: z.array(generatedImageSchema).min(1),
  durationMs: z.number().nonnegative(),
  history: imageHistoryRecordSchema.optional()
});

export const publicConfigSchema = z.object({
  defaultModel: z.string().min(1),
  defaultSize: imageSizeSchema,
  sizes: z.array(imageSizeSchema).min(1),
  defaultQuality: imageQualitySchema,
  qualities: z.array(imageQualitySchema).min(1),
  maxParallelImageJobs: z.number().int().positive().default(2),
  supportsImageEdit: z.boolean()
});

export const apiErrorCodeSchema = z.enum([
  'CONFIG_MISSING',
  'VALIDATION_ERROR',
  'PROVIDER_UNREACHABLE',
  'PROVIDER_ERROR',
  'UNSUPPORTED_PROVIDER_RESPONSE'
]);

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.string().optional()
  })
});

export type ImageGenerationRequest = z.infer<typeof imageGenerationRequestSchema>;
export type ImageEditFields = z.infer<typeof imageEditFieldsSchema>;
export type ImageQuality = z.infer<typeof imageQualitySchema>;
export type GeneratedImage = z.infer<typeof generatedImageSchema>;
export type ImageHistoryImage = z.infer<typeof imageHistoryImageSchema>;
export type ImageHistoryRecord = z.infer<typeof imageHistoryRecordSchema>;
export type ImageHistoryResponse = z.infer<typeof imageHistoryResponseSchema>;
export type ImageJobStatus = z.infer<typeof imageJobStatusSchema>;
export type ImageJobRecord = z.infer<typeof imageJobRecordSchema>;
export type ImageJobResponse = z.infer<typeof imageJobResponseSchema>;
export type ImageJobsResponse = z.infer<typeof imageJobsResponseSchema>;
export type ImageResponse = z.infer<typeof imageResponseSchema>;
export type PublicConfig = z.infer<typeof publicConfigSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
