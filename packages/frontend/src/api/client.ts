// The single place HTTP happens. Everything else in the app goes through these two functions, so
// credentials, error shaping and the /api prefix are decided once.

/** Thrown for any non-2xx API response, carrying the status so callers can branch on it. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = await response.text();
  return new ApiError(response.status, body || response.statusText);
}

/** GETs an API path and parses JSON. Cookies ride along for the session. */
export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

/**
 * POSTs a JSON body to an API path and parses the JSON response. `keepalive` lets a request that is
 * already in flight when the page goes away finish instead of being cancelled with the document. A
 * write that has not started yet at that point needs `beaconOps` instead - see sync/ops.ts.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}
