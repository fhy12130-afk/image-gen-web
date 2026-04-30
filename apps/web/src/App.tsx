import { useEffect, useState } from 'react';
import type { ImageHistoryRecord, ImageJobRecord, ImageQuality, PublicConfig } from '@image-gen-web/shared';
import {
  clearFinishedJobs,
  clearHistory as clearImageHistory,
  fetchJobs,
  fetchHistory,
  fetchPublicConfig,
  queueImageEdit,
  queueImageGeneration,
  retryImageJob
} from './api';
import { compressImageFile, formatBytes, type ImageCompressionRecord } from './imageCompression';

type Mode = 'text' | 'image';

const fallbackConfig: PublicConfig = {
  defaultModel: 'gptimage2',
  defaultSize: 'auto',
  sizes: ['auto', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840'],
  defaultQuality: 'medium',
  qualities: ['low', 'medium', 'high'],
  maxParallelImageJobs: 2,
  supportsImageEdit: true
};

export default function App() {
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
  const [isQueuing, setIsQueuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      .catch(() => setError('Unable to load API config. Check whether the API server is running.'));

    void loadHistory();
    void loadJobs();
    const intervalId = window.setInterval(() => {
      void loadJobs();
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, []);

  async function loadHistory() {
    try {
      const history = await fetchHistory();
      setHistoryRecords(Array.isArray(history.records) ? history.records : []);
    } catch {
      setHistoryRecords([]);
    }
  }

  async function loadJobs() {
    try {
      const response = await fetchJobs();
      setJobs(Array.isArray(response.jobs) ? response.jobs : []);
    } catch {
      // The history list still works even if the transient job queue is unavailable.
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!prompt.trim()) {
      setError('Prompt is required.');
      return;
    }

    if (mode === 'image' && images.length === 0) {
      setError('At least one reference image is required for image-to-image.');
      return;
    }

    setIsQueuing(true);
    try {
      const selectedSize = customSize.trim() || size;
      const response =
        mode === 'text'
          ? await queueImageGeneration({ prompt, model, size: selectedSize, quality, n: 1 })
          : await queueImageEdit({ prompt, model, size: selectedSize, quality, images: images.map((image) => image.file) });
      if (!response.job) {
        throw new Error('Image job response was missing job details.');
      }
      setJobs((currentJobs) => [response.job, ...currentJobs.filter((job) => job.id !== response.job.id)]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Image job could not be queued.');
    } finally {
      setIsQueuing(false);
    }
  }

  async function handleClearHistory() {
    setError(null);
    try {
      const [historyResponse, jobsResponse] = await Promise.all([clearImageHistory(), clearFinishedJobs()]);
      setHistoryRecords(historyResponse.records);
      setJobs(jobsResponse.jobs);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to clear history.');
    }
  }

  async function handleRetryJob(job: ImageJobRecord) {
    setError(null);
    try {
      const response = await retryImageJob(job.id);
      setJobs((currentJobs) => currentJobs.map((currentJob) => (currentJob.id === response.job.id ? response.job : currentJob)));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to retry image job.');
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
      <section className="hero-panel">
        <p className="eyebrow">Image Gen Web</p>
        <h1>Generate images through your own model endpoint</h1>
        <p className="hero-copy">
          Keep provider keys on the server, choose size and quality, upload reference images, and reuse saved history.
        </p>
      </section>

      <section className="workspace">
        <form className="control-card" onSubmit={handleSubmit}>
          <div className="mode-switch" aria-label="Generation mode">
            <button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>
              Text to image
            </button>
            <button type="button" className={mode === 'image' ? 'active' : ''} onClick={() => setMode('image')}>
              Image to image
            </button>
          </div>

          <label>
            Prompt
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="cinematic neon city portrait"
            />
          </label>

          <label>
            Model
            <input value={model} onChange={(event) => setModel(event.target.value)} />
          </label>

          <label>
            Size
            <select value={size} onChange={(event) => setSize(event.target.value)}>
              {config.sizes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label>
            Custom size
            <input value={customSize} onChange={(event) => setCustomSize(event.target.value)} placeholder="1280x720 or auto" />
          </label>

          <label>
            Quality
            <select value={quality} onChange={(event) => setQuality(event.target.value as ImageQuality)}>
              {config.qualities.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          {mode === 'image' ? (
            <div className="upload-group">
              <label>
                Reference image
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
                <ul className="selected-files" aria-label="Selected reference images">
                  {images.map((selectedImage) => (
                    <li key={`${selectedImage.originalName}-${selectedImage.originalBytes}-${selectedImage.file.lastModified}`}>
                      <span>{selectedImage.originalName}</span>
                      <small>
                        {formatBytes(selectedImage.originalBytes)} -&gt; {formatBytes(selectedImage.compressedBytes)} -{' '}
                        {selectedImage.status}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <button className="submit-button" type="submit" disabled={isQueuing}>
            {isQueuing ? 'Queueing...' : 'Queue image job'}
          </button>

          {error ? <p className="error-message">{error}</p> : null}
        </form>

        <section className="result-card" aria-label="Generation jobs">
          <div className="result-header">
            <h2>Generation jobs</h2>
            <span>
              {visibleJobs.filter((job) => job.status === 'running').length} running /{' '}
              {visibleJobs.filter((job) => job.status === 'queued').length} queued
            </span>
          </div>
          {visibleJobs.length === 0 ? <p className="empty-state">Queued jobs will appear here immediately.</p> : null}
          <div className="history-list">
            {visibleJobs.map((job) => (
              <article className={`history-item job-${job.status}`} key={job.id}>
                {job.history?.images[0]?.url ? (
                  <img src={job.history.images[0].url} alt="" />
                ) : (
                  <div className="job-thumb" aria-hidden="true">
                    {job.status}
                  </div>
                )}
                <div>
                  <h3>{job.prompt}</h3>
                  <p>
                    {job.mode} - {job.model} - {job.size} - {job.quality}
                  </p>
                  <small>{formatJobStatus(job)}</small>
                  {job.error ? <p className="error-message">{job.error}</p> : null}
                  <div className="result-actions">
                    {job.history?.images.map((image, index) => (
                      <a key={image.id} href={image.downloadUrl} download>
                        Download {job.history && job.history.images.length > 1 ? index + 1 : ''}
                      </a>
                    ))}
                    {job.status === 'failed' ? (
                      <button type="button" onClick={() => void handleRetryJob(job)}>
                        Retry
                      </button>
                    ) : null}
                    <button type="button" onClick={() => restoreJob(job)}>
                      Restore
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="history-panel" aria-label="Generation history">
          <div className="result-header">
            <h2>History</h2>
            <button
              className="text-button"
              type="button"
              onClick={handleClearHistory}
              disabled={historyRecords.length === 0 && jobs.length === 0}
            >
              Clear finished
            </button>
          </div>
          {savedHistoryRecords.length === 0 ? <p className="empty-state compact">Older saved generations will appear here.</p> : null}
          <div className="history-list">
            {savedHistoryRecords.map((record) => (
              <article className="history-item" key={record.id}>
                <img src={record.images[0]?.url} alt="" />
                <div>
                  <h3>{record.prompt}</h3>
                  <p>
                    {record.mode} - {record.model} - {record.size}
                    {record.quality ? ` - ${record.quality}` : ''}
                  </p>
                  <small>
                    {new Date(record.createdAt).toLocaleString()} - {record.durationMs} ms
                  </small>
                  <div className="result-actions">
                    {record.images.map((image, index) => (
                      <a key={image.id} href={image.downloadUrl} download>
                        Download {record.images.length > 1 ? index + 1 : ''}
                      </a>
                    ))}
                    <button type="button" onClick={() => restoreHistory(record)}>
                      Restore
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

function formatJobStatus(job: ImageJobRecord): string {
  if (job.status === 'queued') {
    return `Queued at ${new Date(job.createdAt).toLocaleTimeString()}`;
  }

  if (job.status === 'running') {
    return `Running since ${new Date(job.startedAt || job.updatedAt).toLocaleTimeString()}`;
  }

  if (job.status === 'succeeded') {
    return `Finished in ${job.durationMs ?? 0} ms`;
  }

  return `Failed at ${new Date(job.finishedAt || job.updatedAt).toLocaleTimeString()}`;
}

function mergeSelectedImages(currentImages: ImageCompressionRecord[], selectedFiles: ImageCompressionRecord[]): ImageCompressionRecord[] {
  const byIdentity = new Map<string, ImageCompressionRecord>();
  for (const image of [...currentImages, ...selectedFiles]) {
    byIdentity.set(`${image.originalName}-${image.originalBytes}-${image.file.lastModified}`, image);
  }
  return Array.from(byIdentity.values()).slice(0, 10);
}
