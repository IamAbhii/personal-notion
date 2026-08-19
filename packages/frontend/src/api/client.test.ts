import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet, apiPost } from './client';

afterEach(() => {
  vi.restoreAllMocks();
});

// ── ApiError ───────────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('carries the HTTP status code', () => {
    const err = new ApiError(404, 'Not Found');
    expect(err.status).toBe(404);
  });

  it('is named ApiError for easier catch branching', () => {
    const err = new ApiError(500, 'Internal error');
    expect(err.name).toBe('ApiError');
  });

  it('extends Error so it can be caught generically', () => {
    const err = new ApiError(400, 'Bad Request');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Bad Request');
  });
});

// ── apiGet ─────────────────────────────────────────────────────────────────────

describe('apiGet', () => {
  it('returns parsed JSON on a 200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await apiGet<{ ok: boolean }>('/api/test');
    expect(result).toEqual({ ok: true });
  });

  it('sends credentials and an Accept header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await apiGet('/api/test');
    const [, options] = fetchSpy.mock.calls[0]!;
    expect((options as RequestInit).credentials).toBe('same-origin');
    expect((options as RequestInit).headers).toMatchObject({ Accept: 'application/json' });
  });

  it('throws ApiError on a non-2xx status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));
    await expect(apiGet('/api/missing')).rejects.toBeInstanceOf(ApiError);
  });

  it('throws ApiError with the response status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Gone', { status: 410 }));
    try {
      await apiGet('/api/gone');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as ApiError).status).toBe(410);
    }
  });
});

// ── apiPost ────────────────────────────────────────────────────────────────────

describe('apiPost', () => {
  it('returns parsed JSON on a 200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'x' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await apiPost<{ id: string }>('/api/sync', { ops: [] });
    expect(result).toEqual({ id: 'x' });
  });

  it('sends a JSON body with the Content-Type header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await apiPost('/api/sync', { ops: [1, 2, 3] });
    const [, options] = fetchSpy.mock.calls[0]!;
    expect((options as RequestInit).method).toBe('POST');
    expect((options as RequestInit).body).toBe(JSON.stringify({ ops: [1, 2, 3] }));
    expect((options as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/json',
    });
  });

  it('sets keepalive so in-flight requests survive page unload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await apiPost('/api/sync', {});
    const [, options] = fetchSpy.mock.calls[0]!;
    expect((options as RequestInit).keepalive).toBe(true);
  });

  it('throws ApiError on a non-2xx status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    await expect(apiPost('/api/sync', {})).rejects.toBeInstanceOf(ApiError);
  });
});
