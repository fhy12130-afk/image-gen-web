import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { parseResponse } from './api';

describe('App', () => {
  it('renders text-to-image controls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ defaultModel: 'gptimage2', sizes: ['1024x1024'], supportsImageEdit: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    render(<App />);

    expect(await screen.findByDisplayValue('gptimage2')).toBeInTheDocument();
    expect(screen.getByLabelText(/Prompt/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Queue image job/i })).toBeInTheDocument();
  });

  it('shows image upload after switching to image-to-image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ defaultModel: 'gptimage2', sizes: ['1024x1024'], supportsImageEdit: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    render(<App />);
    await screen.findByDisplayValue('gptimage2');

    await userEvent.click(screen.getByRole('button', { name: /Image to image/i }));

    expect(screen.getByLabelText(/Reference image/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reference image/i)).toHaveAttribute('multiple');
  });

  it('shows selected reference image filenames', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ defaultModel: 'gptimage2', sizes: ['1024x1024'], supportsImageEdit: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    render(<App />);
    await screen.findByDisplayValue('gptimage2');
    await userEvent.click(screen.getByRole('button', { name: /Image to image/i }));

    await userEvent.upload(screen.getByLabelText(/Reference image/i), [
      new File(['a'], 'first.png', { type: 'image/png' }),
      new File(['b'], 'second.png', { type: 'image/png' })
    ]);

    expect(screen.getByText('first.png')).toBeInTheDocument();
    expect(screen.getByText('second.png')).toBeInTheDocument();
    expect(screen.getAllByText(/1 B -> 1 B/)).toHaveLength(2);
  });

  it('keeps previous reference images when selecting more files later', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ defaultModel: 'gptimage2', sizes: ['1024x1024'], supportsImageEdit: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    render(<App />);
    await screen.findByDisplayValue('gptimage2');
    await userEvent.click(screen.getByRole('button', { name: /Image to image/i }));
    const input = screen.getByLabelText(/Reference image/i);

    await userEvent.upload(input, new File(['a'], 'first.png', { type: 'image/png' }));
    await userEvent.upload(input, new File(['b'], 'second.png', { type: 'image/png' }));

    expect(screen.getByText('first.png')).toBeInTheDocument();
    expect(screen.getByText('second.png')).toBeInTheDocument();
  });

  it('sends multiple images for image-to-image requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/config/public') {
        return new Response(JSON.stringify({ defaultModel: 'gpt-image-2', sizes: ['1024x1024'], supportsImageEdit: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ images: [{ url: 'https://cdn.example.com/a.png', b64Json: null }], durationMs: 100 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByDisplayValue('gpt-image-2');
    await userEvent.click(screen.getByRole('button', { name: /Image to image/i }));
    await userEvent.type(screen.getByLabelText(/Prompt/i), 'combine references');
    await userEvent.upload(screen.getByLabelText(/Reference image/i), [
      new File(['a'], 'first.png', { type: 'image/png' }),
      new File(['b'], 'second.png', { type: 'image/png' })
    ]);
    await userEvent.click(screen.getByRole('button', { name: /Queue image job/i }));

    const editCall = fetchMock.mock.calls.find(([input]) => String(input) === '/api/jobs/image/edit');
    const form = editCall?.[1]?.body as FormData;
    expect(form.getAll('image')).toHaveLength(2);
  });

  it('sends compressed reference files for image-to-image requests', async () => {
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:reference'),
      revokeObjectURL: vi.fn()
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlob(callback) {
      callback(new Blob(['z'], { type: 'image/jpeg' }));
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/config/public') {
        return new Response(JSON.stringify({ defaultModel: 'gpt-image-2', sizes: ['1024x1024'], supportsImageEdit: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ images: [{ url: 'https://cdn.example.com/a.png', b64Json: null }], durationMs: 100 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByDisplayValue('gpt-image-2');
    await userEvent.click(screen.getByRole('button', { name: /Image to image/i }));
    await userEvent.type(screen.getByLabelText(/Prompt/i), 'combine references');
    await userEvent.upload(screen.getByLabelText(/Reference image/i), new File(['original'], 'first.png', { type: 'image/png' }));
    expect(await screen.findByText(/compressed/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Queue image job/i }));

    const editCall = fetchMock.mock.calls.find(([input]) => String(input) === '/api/jobs/image/edit');
    const form = editCall?.[1]?.body as FormData;
    const uploadedImage = form.get('image') as File;
    expect(uploadedImage.name).toBe('first-compressed.jpg');
  });

  it('uses a custom size when generating images', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/config/public') {
        return new Response(JSON.stringify({ defaultModel: 'gpt-image-2', sizes: ['auto', '1024x1024'], supportsImageEdit: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ images: [{ url: 'https://cdn.example.com/a.png', b64Json: null }], durationMs: 100 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByDisplayValue('gpt-image-2');

    await userEvent.type(screen.getByLabelText(/Prompt/i), 'a neon fox');
    await userEvent.type(screen.getByLabelText(/Custom size/i), '1280x720');
    await userEvent.click(screen.getByRole('button', { name: /Queue image job/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/jobs/image/generate',
      expect.objectContaining({ body: expect.stringContaining('1280x720') })
    );
  });

  it('sends the selected quality when generating images', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/config/public') {
        return new Response(
          JSON.stringify({
            defaultModel: 'gpt-image-2',
            defaultSize: 'auto',
            sizes: ['auto', '1024x1024'],
            defaultQuality: 'medium',
            qualities: ['low', 'medium', 'high'],
            supportsImageEdit: true
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (String(input) === '/api/history') {
        return new Response(JSON.stringify({ records: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ images: [{ url: 'https://cdn.example.com/a.png', b64Json: null }], durationMs: 100 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByDisplayValue('gpt-image-2');

    await userEvent.selectOptions(screen.getByLabelText(/Quality/i), 'high');
    await userEvent.type(screen.getByLabelText(/Prompt/i), 'a neon skyline');
    await userEvent.click(screen.getByRole('button', { name: /Queue image job/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/jobs/image/generate',
      expect.objectContaining({ body: expect.stringContaining('"quality":"high"') })
    );
  });

  it('renders history and restores a previous generation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/config/public') {
        return new Response(
          JSON.stringify({
            defaultModel: 'gpt-image-2',
            defaultSize: 'auto',
            sizes: ['auto', '1024x1024', '2048x2048'],
            defaultQuality: 'medium',
            qualities: ['low', 'medium', 'high'],
            supportsImageEdit: true
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          records: [
            {
              id: 'hist_1',
              createdAt: '2026-04-29T00:00:00.000Z',
              mode: 'text',
              prompt: 'saved prompt',
              model: 'gpt-image-2',
              size: '2048x2048',
              quality: 'low',
              durationMs: 123,
              images: [
                {
                  id: 'img_1',
                  fileName: 'img_1.png',
                  mimeType: 'image/png',
                  bytes: 3,
                  url: 'http://localhost:8787/api/history/image/img_1.png',
                  downloadUrl: 'http://localhost:8787/api/history/image/img_1.png?download=1'
                }
              ]
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('saved prompt')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Restore/i }));

    expect(screen.getByLabelText(/Prompt/i)).toHaveValue('saved prompt');
    expect(screen.getByLabelText(/^Size$/i)).toHaveValue('2048x2048');
    expect(screen.getByLabelText(/Quality/i)).toHaveValue('low');
  });

  it('renders a download action for generated images', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/config/public') {
          return new Response(JSON.stringify({ defaultModel: 'gpt-image-2', sizes: ['auto', '1024x1024'], supportsImageEdit: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ job: succeededJob('a neon fox') }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );

    render(<App />);
    await screen.findByDisplayValue('gpt-image-2');

    await userEvent.type(screen.getByLabelText(/Prompt/i), 'a neon fox');
    await userEvent.click(screen.getByRole('button', { name: /Queue image job/i }));

    expect(await screen.findByRole('link', { name: /Download/i })).toBeInTheDocument();
  });

  it('cancels queued image jobs', async () => {
    const queued = queuedJob('queued fox');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/config/public') {
        return new Response(JSON.stringify({ defaultModel: 'gpt-image-2', sizes: ['auto', '1024x1024'], supportsImageEdit: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (String(input) === '/api/history') {
        return new Response(JSON.stringify({ records: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (String(input) === '/api/jobs/job_1/cancel') {
        return new Response(
          JSON.stringify({ job: { ...queued, status: 'canceled', finishedAt: '2026-04-29T00:00:02.000Z' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ jobs: [queued], maxParallel: 2, runningCount: 0, queuedCount: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('queued fox')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    expect(fetchMock).toHaveBeenCalledWith('/api/jobs/job_1/cancel', expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByText(/Canceled at/i)).toBeInTheDocument();
  });
});

function succeededJob(prompt: string) {
  return {
    id: 'job_1',
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:01.000Z',
    status: 'succeeded',
    mode: 'text',
    prompt,
    model: 'gpt-image-2',
    size: '1024x1024',
    quality: 'medium',
    imageCount: 0,
    finishedAt: '2026-04-29T00:00:01.000Z',
    durationMs: 100,
    history: {
      id: 'hist_1',
      createdAt: '2026-04-29T00:00:01.000Z',
      mode: 'text',
      prompt,
      model: 'gpt-image-2',
      size: '1024x1024',
      quality: 'medium',
      durationMs: 100,
      images: [
        {
          id: 'img_1',
          fileName: 'img_1.png',
          mimeType: 'image/png',
          bytes: 3,
          url: 'http://localhost:8787/api/history/image/img_1.png',
          downloadUrl: 'http://localhost:8787/api/history/image/img_1.png?download=1'
        }
      ]
    }
  };
}

function queuedJob(prompt: string) {
  return {
    id: 'job_1',
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:01.000Z',
    status: 'queued',
    mode: 'text',
    prompt,
    model: 'gpt-image-2',
    size: '1024x1024',
    quality: 'medium',
    imageCount: 0
  };
}

class FakeImage {
  naturalWidth = 2000;
  naturalHeight = 1000;
  width = 2000;
  height = 1000;
  src = '';

  decode() {
    return Promise.resolve();
  }
}

describe('parseResponse', () => {
  it('includes API error details in thrown messages', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          message: 'Image provider request failed.',
          details: '{"error":{"message":"Only one image is supported"}}'
        }
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );

    await expect(parseResponse(response)).rejects.toThrow('Only one image is supported');
  });

  it('uses plain text response body when JSON error parsing is not available', async () => {
    const response = new Response('upstream gateway timeout', { status: 504 });

    await expect(parseResponse(response)).rejects.toThrow('upstream gateway timeout');
  });

  it('adds request ids to API error messages', async () => {
    const response = new Response(JSON.stringify({ error: { message: 'provider failed' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'edit-abc123' }
    });

    await expect(parseResponse(response)).rejects.toThrow('Request ID: edit-abc123');
  });
});
