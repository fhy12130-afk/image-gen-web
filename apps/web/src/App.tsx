import { useEffect, useState } from 'react';
import type { ApiSettingsResponse, ClientJobSettings, ImageHistoryRecord, ImageJobRecord, ImageQuality, ProviderCredentials, PublicConfig } from '@image-gen-web/shared';
import {
  cancelImageJob,
  clearFinishedJobs,
  clearHistory as clearImageHistory,
  fetchJobs,
  fetchHistory,
  fetchPublicConfig,
  fetchSettings,
  queueImageEdit,
  queueImageGeneration,
  retryImageJob
} from './api';
import { compressImageFile, formatBytes, type ImageCompressionRecord } from './imageCompression';
import { getInitialLanguage, localeFor, nextLanguage, persistLanguage, translations, type Language, type Mode } from './i18n';

const fallbackConfig: PublicConfig = {
  defaultModel: 'gptimage2',
  defaultSize: 'auto',
  sizes: ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840'],
  defaultQuality: 'medium',
  qualities: ['low', 'medium', 'high'],
  maxParallelImageJobs: 2,
  maxUserParallelImageJobs: 20,
  supportsImageEdit: true
};

const CLIENT_PROVIDER_SETTINGS_KEY = 'image-gen-web-client-provider';
const CLIENT_ID_KEY = 'image-gen-web-client-id';
type SettingsFormState = { baseUrl: string; apiKey: string; maxParallelImageJobs: string };

export default function App() {
  const [language, setLanguage] = useState<Language>(() => getInitialLanguage());
  const [mode, setMode] = useState<Mode>('text');
  const [config, setConfig] = useState<PublicConfig>(fallbackConfig);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(fallbackConfig.defaultModel);
  const [size, setSize] = useState(fallbackConfig.defaultSize);
  const [quality, setQuality] = useState<ImageQuality>(fallbackConfig.defaultQuality);
  const [customSize, setCustomSize] = useState('');
  const [images, setImages] = useState<ImageCompressionRecord[]>([]);
  const [jobs, setJobs] = useState<ImageJobRecord[]>([]);
  const [historyRecords, setHistoryRecords] = useState<ImageHistoryRecord[]>([]);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>(() => loadClientProviderSettings());
  const [clientId] = useState(() => loadClientId());
  const [serverBaseUrl, setServerBaseUrl] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [isQueuing, setIsQueuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = translations[language];

  useEffect(() => {
    fetchPublicConfig()
      .then((nextConfig) => {
        const normalizedConfig: PublicConfig = {
          ...fallbackConfig,
          ...nextConfig,
          sizes: nextConfig.sizes?.length ? nextConfig.sizes : fallbackConfig.sizes,
          qualities: nextConfig.qualities?.length ? nextConfig.qualities : fallbackConfig.qualities
        };
        setConfig(normalizedConfig);
        setModel(normalizedConfig.defaultModel);
        setSize(normalizedConfig.defaultSize || normalizedConfig.sizes[0] || fallbackConfig.defaultSize);
        setQuality(normalizedConfig.defaultQuality || fallbackConfig.defaultQuality);
      })
      .catch(() => setError(translations[getInitialLanguage()].configLoadFailed));

    void loadHistory();
    void loadJobs();
    void loadSettings();
    const intervalId = window.setInterval(() => {
      void loadJobs();
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = t.documentTitle;
    persistLanguage(language);
  }, [language, t.documentTitle]);

  async function loadHistory() {
    try {
      const history = await fetchHistory(clientId);
      setHistoryRecords(Array.isArray(history.records) ? history.records : []);
    } catch {
      setHistoryRecords([]);
    }
  }

  async function loadSettings() {
    try {
      applyServerSettings(await fetchSettings());
    } catch {
      // Settings are optional for older API servers; generation errors still surface normally.
    }
  }

  function applyServerSettings(settings: ApiSettingsResponse) {
    const defaultBaseUrl = typeof settings.baseUrl === 'string' ? settings.baseUrl : '';
    setServerBaseUrl(defaultBaseUrl);
    setSettingsForm((current) => ({
      ...current,
      maxParallelImageJobs: current.maxParallelImageJobs || String(config.maxUserParallelImageJobs || settings.maxParallelImageJobs)
    }));
    setConfig((currentConfig) => ({
      ...currentConfig,
      defaultModel: settings.defaultModel || currentConfig.defaultModel
    }));
  }

  async function loadJobs() {
    try {
      const response = await fetchJobs(clientId);
      setJobs(Array.isArray(response.jobs) ? response.jobs : []);
    } catch {
      // The history list still works even if the transient job queue is unavailable.
    }
  }

  function getProviderCredentials(): ProviderCredentials | null {
    const baseUrl = settingsForm.baseUrl.trim();
    const apiKey = settingsForm.apiKey.trim();
    return apiKey ? { ...(baseUrl ? { baseUrl } : {}), apiKey } : null;
  }

  function getClientSettings(): ClientJobSettings {
    return {
      id: clientId,
      maxParallelJobs: clampParallelJobs(Number(settingsForm.maxParallelImageJobs), config.maxUserParallelImageJobs || config.maxParallelImageJobs)
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!prompt.trim()) {
      setError(t.promptRequired);
      return;
    }

    if (mode === 'image' && images.length === 0) {
      setError(t.referenceRequired);
      return;
    }

    const provider = getProviderCredentials();
    if (!provider) {
      setError(t.providerCredentialsRequired);
      setIsSettingsOpen(true);
      return;
    }

    setIsQueuing(true);
    try {
      const selectedSize = customSize.trim() || size;
      const client = getClientSettings();
      const response =
        mode === 'text'
          ? await queueImageGeneration({ prompt, model, size: selectedSize, quality, n: 1, provider, client })
          : await queueImageEdit({ prompt, model, size: selectedSize, quality, images: images.map((image) => image.file), provider, client });
      if (!response.job) {
        throw new Error(t.missingJobDetails);
      }
      setJobs((currentJobs) => [response.job, ...currentJobs.filter((job) => job.id !== response.job.id)]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t.queueFailed);
    } finally {
      setIsQueuing(false);
    }
  }

  async function handleClearHistory(): Promise<boolean> {
    setError(null);
    try {
      const [historyResponse, jobsResponse] = await Promise.all([clearImageHistory(clientId), clearFinishedJobs(clientId)]);
      setHistoryRecords(historyResponse.records);
      setJobs(jobsResponse.jobs);
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t.clearHistoryFailed);
      return false;
    }
  }

  async function handleSaveSettings(event: React.FormEvent) {
    event.preventDefault();
    setSettingsMessage(null);
    setError(null);
    setIsSavingSettings(true);
    try {
      const maxParallelJobs = Number(settingsForm.maxParallelImageJobs);
      const maxUserParallel = config.maxUserParallelImageJobs || config.maxParallelImageJobs;
      if (!Number.isInteger(maxParallelJobs) || maxParallelJobs < 1 || maxParallelJobs > maxUserParallel) {
        setSettingsMessage(t.settingsSaveFailed);
        return;
      }

      const nextSettings: SettingsFormState = {
        baseUrl: settingsForm.baseUrl.trim(),
        apiKey: settingsForm.apiKey.trim(),
        maxParallelImageJobs: String(maxParallelJobs)
      };

      saveClientProviderSettings(nextSettings);
      setSettingsForm((current) => ({
        ...current,
        baseUrl: nextSettings.baseUrl,
        apiKey: nextSettings.apiKey,
        maxParallelImageJobs: nextSettings.maxParallelImageJobs
      }));
      setSettingsMessage(t.settingsSaved);
    } catch (requestError) {
      setSettingsMessage(requestError instanceof Error ? requestError.message : t.settingsSaveFailed);
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleSettingsClearHistory() {
    setSettingsMessage(null);
    if (await handleClearHistory()) {
      setSettingsMessage(t.historyCleared);
    }
  }

  async function handleRetryJob(job: ImageJobRecord) {
    setError(null);
    try {
      const provider = getProviderCredentials();
      if (!provider) {
        setError(t.providerCredentialsRequired);
        setIsSettingsOpen(true);
        return;
      }

      const response = await retryImageJob(job.id, provider, getClientSettings());
      setJobs((currentJobs) => currentJobs.map((currentJob) => (currentJob.id === response.job.id ? response.job : currentJob)));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t.retryFailed);
    }
  }

  async function handleCancelJob(job: ImageJobRecord) {
    setError(null);
    try {
      const response = await cancelImageJob(job.id, clientId);
      setJobs((currentJobs) => currentJobs.map((currentJob) => (currentJob.id === response.job.id ? response.job : currentJob)));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t.cancelFailed);
    }
  }

  function restoreHistory(record: ImageHistoryRecord) {
    setMode(record.mode);
    setPrompt(record.prompt);
    setModel(record.model);
    setQuality(record.quality || config.defaultQuality);
    if (config.sizes.includes(record.size)) {
      setSize(record.size);
      setCustomSize('');
    } else {
      setSize(config.defaultSize);
      setCustomSize(record.size);
    }
  }

  function restoreJob(job: ImageJobRecord) {
    restoreHistory({
      id: job.history?.id || job.id,
      createdAt: job.createdAt,
      mode: job.mode,
      prompt: job.prompt,
      model: job.model,
      size: job.size,
      quality: job.quality,
      durationMs: job.durationMs || 0,
      images: job.history?.images || [
        {
          id: `${job.id}_placeholder`,
          fileName: '',
          mimeType: 'image/png',
          bytes: 0,
          url: '',
          downloadUrl: ''
        }
      ]
    });
  }

  const visibleJobs = jobs.filter((job): job is ImageJobRecord => Boolean(job));
  const jobHistoryIds = new Set(visibleJobs.map((job) => job.history?.id).filter(Boolean));
  const savedHistoryRecords = historyRecords.filter((record) => !jobHistoryIds.has(record.id));

  return (
    <main className="app-shell">
      <div className="top-actions">
        <button type="button" className="settings-button" onClick={() => setIsSettingsOpen(true)}>
          {t.settingsButton}
        </button>
        <button
          type="button"
          className="settings-button"
          aria-label={t.languageAriaLabel}
          onClick={() => setLanguage((currentLanguage) => nextLanguage(currentLanguage))}
        >
          {t.languageButton}
        </button>
      </div>

      <section className="hero-panel">
        <p className="eyebrow">Image Gen Web</p>
        <h1>{t.heroTitle}</h1>
        <p className="hero-copy">{t.heroCopy}</p>
      </section>

      {isSettingsOpen ? (
        <section className="settings-panel" aria-label={t.settingsAriaLabel}>
          <div className="settings-header">
            <h2>{t.settingsButton}</h2>
            <button type="button" className="text-button" onClick={() => setIsSettingsOpen(false)}>
              {t.close}
            </button>
          </div>
          <form className="settings-form" onSubmit={handleSaveSettings}>
            <label>
              {t.endpointUrl}
              <input
                value={settingsForm.baseUrl}
                onChange={(event) => setSettingsForm((current) => ({ ...current, baseUrl: event.target.value }))}
                placeholder={serverBaseUrl || 'https://your-image-api.example.com/v1'}
              />
            </label>
            <label>
              {t.apiKey}
              <input
                type="password"
                value={settingsForm.apiKey}
                onChange={(event) => setSettingsForm((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder={t.apiKeyPlaceholder}
                autoComplete="off"
              />
            </label>
            <label>
              {t.parallelJobs}
              <input
                type="number"
                min="1"
                max={config.maxUserParallelImageJobs || config.maxParallelImageJobs}
                value={settingsForm.maxParallelImageJobs}
                onChange={(event) => setSettingsForm((current) => ({ ...current, maxParallelImageJobs: event.target.value }))}
              />
            </label>
            <div className="settings-actions">
              <button className="submit-button" type="submit" disabled={isSavingSettings}>
                {isSavingSettings ? t.saving : t.saveSettings}
              </button>
              <button className="text-button" type="button" onClick={() => void handleSettingsClearHistory()}>
                {t.clearHistory}
              </button>
            </div>
            {settingsMessage ? <p className="settings-message">{settingsMessage}</p> : null}
          </form>
        </section>
      ) : null}

      <section className="workspace">
        <form className="control-card" onSubmit={handleSubmit}>
          <div className="mode-switch" aria-label={t.generationModeAria}>
            <button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>
              {t.textToImage}
            </button>
            <button type="button" className={mode === 'image' ? 'active' : ''} onClick={() => setMode('image')}>
              {t.imageToImage}
            </button>
          </div>

          <label>
            {t.prompt}
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t.promptPlaceholder}
            />
          </label>

          <label>
            {t.model}
            <input value={model} onChange={(event) => setModel(event.target.value)} />
          </label>

          <label>
            {t.size}
            <select value={size} onChange={(event) => setSize(event.target.value)}>
              {config.sizes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t.customSize}
            <input value={customSize} onChange={(event) => setCustomSize(event.target.value)} placeholder={t.customSizePlaceholder} />
          </label>

          <label>
            {t.quality}
            <select value={quality} onChange={(event) => setQuality(event.target.value as ImageQuality)}>
              {config.qualities.map((option) => (
                <option key={option} value={option}>
                  {t.qualityLabels[option]}
                </option>
              ))}
            </select>
          </label>

          {mode === 'image' ? (
            <div className="upload-group">
              <label>
                {t.referenceImage}
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (event) => {
                    const input = event.currentTarget;
                    const selectedFiles = Array.from(event.target.files || []);
                    const compressedImages = await Promise.all(selectedFiles.map((file) => compressImageFile(file)));
                    setImages((currentImages) => mergeSelectedImages(currentImages, compressedImages));
                    input.value = '';
                  }}
                />
              </label>
              {images.length > 0 ? (
                <ul className="selected-files" aria-label={t.selectedReferenceImagesAria}>
                  {images.map((selectedImage) => (
                    <li key={`${selectedImage.originalName}-${selectedImage.originalBytes}-${selectedImage.file.lastModified}`}>
                      <span>{selectedImage.originalName}</span>
                      <small>
                        {t.fileCompressionLine(
                          formatBytes(selectedImage.originalBytes),
                          formatBytes(selectedImage.compressedBytes),
                          t.compressionStatusLabels[selectedImage.status]
                        )}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <button className="submit-button" type="submit" disabled={isQueuing}>
            {isQueuing ? t.queueing : t.queueImageJob}
          </button>

          {error ? <p className="error-message">{error}</p> : null}
        </form>

        <section className="result-card" aria-label={t.generationJobsAria}>
          <div className="result-header">
            <h2>{t.generationJobsTitle}</h2>
            <span>{t.jobCounts(visibleJobs.filter((job) => job.status === 'running').length, visibleJobs.filter((job) => job.status === 'queued').length)}</span>
          </div>
          {visibleJobs.length === 0 ? <p className="empty-state">{t.queuedJobsEmpty}</p> : null}
          <div className="history-list">
            {visibleJobs.map((job) => (
              <article className={`history-item job-${job.status}`} key={job.id}>
                {job.history?.images[0]?.url ? (
                  <img src={job.history.images[0].url} alt="" />
                ) : (
                  <div className="job-thumb" aria-hidden="true">
                    {t.jobStatusLabels[job.status]}
                  </div>
                )}
                <div>
                  <h3>{job.prompt}</h3>
                  <p>
                    {formatRecordSummary(job.mode, job.model, job.size, job.quality, language)}
                  </p>
                  <small>{formatJobStatus(job, language)}</small>
                  {job.error ? <p className="error-message">{job.error}</p> : null}
                  <div className="result-actions">
                    {job.history?.images.map((image, index) => (
                      <a key={image.id} href={image.downloadUrl} download>
                        {t.downloadImage(job.history && job.history.images.length > 1 ? index + 1 : undefined)}
                      </a>
                    ))}
                    {job.status === 'failed' ? (
                      <button type="button" onClick={() => void handleRetryJob(job)}>
                        {t.retry}
                      </button>
                    ) : null}
                    {job.status === 'queued' || job.status === 'running' ? (
                      <button type="button" onClick={() => void handleCancelJob(job)}>
                        {t.cancel}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => restoreJob(job)}>
                      {t.restore}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="history-panel" aria-label={t.historyAria}>
          <div className="result-header">
            <h2>{t.historyTitle}</h2>
            <button
              className="text-button"
              type="button"
              onClick={handleClearHistory}
              disabled={historyRecords.length === 0 && jobs.length === 0}
            >
              {t.clearFinished}
            </button>
          </div>
          {savedHistoryRecords.length === 0 ? <p className="empty-state compact">{t.olderHistoryEmpty}</p> : null}
          <div className="history-list">
            {savedHistoryRecords.map((record) => (
              <article className="history-item" key={record.id}>
                <img src={record.images[0]?.url} alt="" />
                <div>
                  <h3>{record.prompt}</h3>
                  <p>
                    {formatRecordSummary(record.mode, record.model, record.size, record.quality, language)}
                  </p>
                  <small>{t.historyTimestamp(new Date(record.createdAt).toLocaleString(localeFor(language)), record.durationMs)}</small>
                  <div className="result-actions">
                    {record.images.map((image, index) => (
                      <a key={image.id} href={image.downloadUrl} download>
                        {t.downloadImage(record.images.length > 1 ? index + 1 : undefined)}
                      </a>
                    ))}
                    <button type="button" onClick={() => restoreHistory(record)}>
                      {t.restore}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function formatRecordSummary(mode: Mode, model: string, size: string, quality: ImageQuality | undefined, language: Language): string {
  const t = translations[language];
  return [t.modeLabels[mode], model, size, quality ? t.qualityLabels[quality] : null].filter(Boolean).join(' - ');
}

function formatJobStatus(job: ImageJobRecord, language: Language): string {
  const t = translations[language];
  if (job.status === 'queued') {
    return t.jobStatusLine.queued(new Date(job.createdAt).toLocaleTimeString(localeFor(language)));
  }

  if (job.status === 'running') {
    return t.jobStatusLine.running(new Date(job.startedAt || job.updatedAt).toLocaleTimeString(localeFor(language)));
  }

  if (job.status === 'succeeded') {
    return t.jobStatusLine.succeeded(job.durationMs ?? 0);
  }

  if (job.status === 'canceled') {
    return t.jobStatusLine.canceled(new Date(job.finishedAt || job.updatedAt).toLocaleTimeString(localeFor(language)));
  }

  return t.jobStatusLine.failed(new Date(job.finishedAt || job.updatedAt).toLocaleTimeString(localeFor(language)));
}

function mergeSelectedImages(currentImages: ImageCompressionRecord[], selectedFiles: ImageCompressionRecord[]): ImageCompressionRecord[] {
  const byIdentity = new Map<string, ImageCompressionRecord>();
  for (const image of [...currentImages, ...selectedFiles]) {
    byIdentity.set(`${image.originalName}-${image.originalBytes}-${image.file.lastModified}`, image);
  }
  return Array.from(byIdentity.values()).slice(0, 10);
}

function loadClientProviderSettings(): SettingsFormState {
  if (typeof window === 'undefined') {
    return { baseUrl: '', apiKey: '', maxParallelImageJobs: String(fallbackConfig.maxParallelImageJobs) };
  }

  try {
    const storedSettings = JSON.parse(window.localStorage.getItem(CLIENT_PROVIDER_SETTINGS_KEY) || '{}') as Partial<SettingsFormState>;
    return {
      baseUrl: typeof storedSettings.baseUrl === 'string' ? storedSettings.baseUrl : '',
      apiKey: typeof storedSettings.apiKey === 'string' ? storedSettings.apiKey : '',
      maxParallelImageJobs:
        typeof storedSettings.maxParallelImageJobs === 'string' ? storedSettings.maxParallelImageJobs : String(fallbackConfig.maxParallelImageJobs)
    };
  } catch {
    return { baseUrl: '', apiKey: '', maxParallelImageJobs: String(fallbackConfig.maxParallelImageJobs) };
  }
}

function saveClientProviderSettings(settings: SettingsFormState): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    CLIENT_PROVIDER_SETTINGS_KEY,
    JSON.stringify({ baseUrl: settings.baseUrl, apiKey: settings.apiKey, maxParallelImageJobs: settings.maxParallelImageJobs })
  );
}

function loadClientId(): string {
  if (typeof window === 'undefined') {
    return 'server-rendered-client';
  }

  const existingClientId = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existingClientId) {
    return existingClientId;
  }

  const randomId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replaceAll('-', '')
      : Math.random().toString(36).slice(2);
  const nextClientId = `client_${randomId}`;
  window.localStorage.setItem(CLIENT_ID_KEY, nextClientId);
  return nextClientId;
}

function clampParallelJobs(value: number, maxValue: number): number {
  if (!Number.isInteger(value)) {
    return 1;
  }

  return Math.min(Math.max(1, value), Math.max(1, maxValue));
}
