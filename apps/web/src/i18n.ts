import type { ImageJobStatus, ImageQuality } from '@image-gen-web/shared';
import type { ImageCompressionStatus } from './imageCompression';

export type Language = 'en' | 'zh';
export type Mode = 'text' | 'image';

type Copy = {
  documentTitle: string;
  languageButton: string;
  languageAriaLabel: string;
  settingsButton: string;
  settingsAriaLabel: string;
  close: string;
  heroTitle: string;
  heroCopy: string;
  endpointUrl: string;
  apiKey: string;
  savedApiKey: (preview: string) => string;
  apiKeyPlaceholder: string;
  parallelJobs: string;
  saveSettings: string;
  saving: string;
  settingsSaved: string;
  settingsSaveFailed: string;
  providerCredentialsRequired: string;
  clearHistory: string;
  historyCleared: string;
  generationModeAria: string;
  textToImage: string;
  imageToImage: string;
  prompt: string;
  promptPlaceholder: string;
  model: string;
  size: string;
  customSize: string;
  customSizePlaceholder: string;
  quality: string;
  referenceImage: string;
  selectedReferenceImagesAria: string;
  queueing: string;
  queueImageJob: string;
  generationJobsAria: string;
  generationJobsTitle: string;
  jobCounts: (running: number, queued: number) => string;
  queuedJobsEmpty: string;
  historyAria: string;
  historyTitle: string;
  clearFinished: string;
  olderHistoryEmpty: string;
  downloadImage: (index?: number) => string;
  retry: string;
  cancel: string;
  restore: string;
  configLoadFailed: string;
  promptRequired: string;
  referenceRequired: string;
  missingJobDetails: string;
  queueFailed: string;
  clearHistoryFailed: string;
  retryFailed: string;
  cancelFailed: string;
  fileCompressionLine: (originalBytes: string, compressedBytes: string, status: string) => string;
  historyTimestamp: (createdAt: string, durationMs: number) => string;
  modeLabels: Record<Mode, string>;
  qualityLabels: Record<ImageQuality, string>;
  jobStatusLabels: Record<ImageJobStatus, string>;
  compressionStatusLabels: Record<ImageCompressionStatus, string>;
  jobStatusLine: {
    queued: (time: string) => string;
    running: (time: string) => string;
    succeeded: (durationMs: number) => string;
    canceled: (time: string) => string;
    failed: (time: string) => string;
  };
};

export const translations: Record<Language, Copy> = {
  en: {
    documentTitle: 'Image Gen Web',
    languageButton: '中文',
    languageAriaLabel: 'Switch language to Simplified Chinese',
    settingsButton: 'Settings',
    settingsAriaLabel: 'Settings',
    close: 'Close',
    heroTitle: 'Generate images through your own model endpoint',
    heroCopy: 'Use your own provider key from this browser, choose size and quality, upload reference images, and reuse saved history.',
    endpointUrl: 'Endpoint URL',
    apiKey: 'API key',
    savedApiKey: (preview) => `Saved ${preview}`,
    apiKeyPlaceholder: 'sk-...',
    parallelJobs: 'Parallel jobs',
    saveSettings: 'Save settings',
    saving: 'Saving...',
    settingsSaved: 'Settings saved.',
    settingsSaveFailed: 'Unable to save settings.',
    providerCredentialsRequired: 'Enter your API key in Settings first. The default endpoint is used when Endpoint URL is empty.',
    clearHistory: 'Clear history',
    historyCleared: 'History cleared.',
    generationModeAria: 'Generation mode',
    textToImage: 'Text to image',
    imageToImage: 'Image to image',
    prompt: 'Prompt',
    promptPlaceholder: 'cinematic neon city portrait',
    model: 'Model',
    size: 'Size',
    customSize: 'Custom size',
    customSizePlaceholder: '1280x720 or auto',
    quality: 'Quality',
    referenceImage: 'Reference image',
    selectedReferenceImagesAria: 'Selected reference images',
    queueing: 'Queueing...',
    queueImageJob: 'Queue image job',
    generationJobsAria: 'Generation jobs',
    generationJobsTitle: 'Generation jobs',
    jobCounts: (running, queued) => `${running} running / ${queued} queued`,
    queuedJobsEmpty: 'Queued jobs will appear here immediately.',
    historyAria: 'Generation history',
    historyTitle: 'History',
    clearFinished: 'Clear finished',
    olderHistoryEmpty: 'Older saved generations will appear here.',
    downloadImage: (index) => (index ? `Download ${index}` : 'Download'),
    retry: 'Retry',
    cancel: 'Cancel',
    restore: 'Restore',
    configLoadFailed: 'Unable to load API config. Check whether the API server is running.',
    promptRequired: 'Prompt is required.',
    referenceRequired: 'At least one reference image is required for image-to-image.',
    missingJobDetails: 'Image job response was missing job details.',
    queueFailed: 'Image job could not be queued.',
    clearHistoryFailed: 'Unable to clear history.',
    retryFailed: 'Unable to retry image job.',
    cancelFailed: 'Unable to cancel image job.',
    fileCompressionLine: (originalBytes, compressedBytes, status) => `${originalBytes} -> ${compressedBytes} - ${status}`,
    historyTimestamp: (createdAt, durationMs) => `${createdAt} - ${durationMs} ms`,
    modeLabels: {
      text: 'Text to image',
      image: 'Image to image'
    },
    qualityLabels: {
      low: 'Low',
      medium: 'Medium',
      high: 'High'
    },
    jobStatusLabels: {
      queued: 'Queued',
      running: 'Running',
      succeeded: 'Succeeded',
      failed: 'Failed',
      canceled: 'Canceled'
    },
    compressionStatusLabels: {
      compressed: 'compressed',
      unchanged: 'unchanged',
      failed: 'failed'
    },
    jobStatusLine: {
      queued: (time) => `Queued at ${time}`,
      running: (time) => `Running since ${time}`,
      succeeded: (durationMs) => `Finished in ${durationMs} ms`,
      canceled: (time) => `Canceled at ${time}`,
      failed: (time) => `Failed at ${time}`
    }
  },
  zh: {
    documentTitle: 'Image Gen Web',
    languageButton: 'English',
    languageAriaLabel: '切换语言为英文',
    settingsButton: '设置',
    settingsAriaLabel: '设置',
    close: '关闭',
    heroTitle: '通过你自己的模型接口生成图片',
    heroCopy: '使用保存在本浏览器的你自己的 API Key，选择尺寸和质量，上传参考图，并复用生成历史。',
    endpointUrl: '接口地址',
    apiKey: 'API Key',
    savedApiKey: (preview) => `已保存 ${preview}`,
    apiKeyPlaceholder: 'sk-...',
    parallelJobs: '并行任务数',
    saveSettings: '保存设置',
    saving: '保存中...',
    settingsSaved: '设置已保存。',
    settingsSaveFailed: '无法保存设置。',
    providerCredentialsRequired: '请先在设置中填写 API Key；接口地址留空时会使用默认接口。',
    clearHistory: '清空历史',
    historyCleared: '历史已清空。',
    generationModeAria: '生成模式',
    textToImage: '文生图',
    imageToImage: '图生图',
    prompt: '提示词',
    promptPlaceholder: '电影感霓虹城市人像',
    model: '模型',
    size: '尺寸',
    customSize: '自定义尺寸',
    customSizePlaceholder: '1280x720 或 auto',
    quality: '质量',
    referenceImage: '参考图',
    selectedReferenceImagesAria: '已选择的参考图',
    queueing: '加入队列中...',
    queueImageJob: '加入生成队列',
    generationJobsAria: '生成任务',
    generationJobsTitle: '生成任务',
    jobCounts: (running, queued) => `${running} 个运行中 / ${queued} 个排队中`,
    queuedJobsEmpty: '提交后的生成任务会立即显示在这里。',
    historyAria: '生成历史',
    historyTitle: '历史',
    clearFinished: '清除已完成',
    olderHistoryEmpty: '更早保存的生成记录会显示在这里。',
    downloadImage: (index) => (index ? `下载 ${index}` : '下载'),
    retry: '重试',
    cancel: '取消',
    restore: '恢复参数',
    configLoadFailed: '无法加载 API 配置，请确认 API 服务正在运行。',
    promptRequired: '请输入提示词。',
    referenceRequired: '图生图至少需要一张参考图。',
    missingJobDetails: '生成任务响应缺少任务详情。',
    queueFailed: '无法加入生成队列。',
    clearHistoryFailed: '无法清空历史。',
    retryFailed: '无法重试生成任务。',
    cancelFailed: '无法取消生成任务。',
    fileCompressionLine: (originalBytes, compressedBytes, status) => `${originalBytes} -> ${compressedBytes} - ${status}`,
    historyTimestamp: (createdAt, durationMs) => `${createdAt} - ${durationMs} 毫秒`,
    modeLabels: {
      text: '文生图',
      image: '图生图'
    },
    qualityLabels: {
      low: '低',
      medium: '中',
      high: '高'
    },
    jobStatusLabels: {
      queued: '排队中',
      running: '运行中',
      succeeded: '已完成',
      failed: '失败',
      canceled: '已取消'
    },
    compressionStatusLabels: {
      compressed: '已压缩',
      unchanged: '未改变',
      failed: '压缩失败'
    },
    jobStatusLine: {
      queued: (time) => `${time} 加入队列`,
      running: (time) => `${time} 开始运行`,
      succeeded: (durationMs) => `${durationMs} 毫秒完成`,
      canceled: (time) => `${time} 已取消`,
      failed: (time) => `${time} 失败`
    }
  }
};

export function getInitialLanguage(): Language {
  if (typeof window === 'undefined') {
    return 'en';
  }

  try {
    const storedLanguage = window.localStorage.getItem('image-gen-web-language');
    return storedLanguage === 'zh' || storedLanguage === 'en' ? storedLanguage : 'en';
  } catch {
    return 'en';
  }
}

export function persistLanguage(language: Language): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem('image-gen-web-language', language);
  } catch {
    // Language persistence is best-effort; the toggle still works for this session.
  }
}

export function nextLanguage(language: Language): Language {
  return language === 'en' ? 'zh' : 'en';
}

export function localeFor(language: Language): string | undefined {
  return language === 'zh' ? 'zh-CN' : undefined;
}
