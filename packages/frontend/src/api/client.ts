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

// The Fetch spec limits the total body size of all in-flight keepalive requests to 64 KiB.
// A body larger than that causes fetch() to reject immediately with a TypeError ("Failed to fetch" /
// "Load failed") before any bytes go on the wire. Base64-encoded screenshots are 200-600 KB, so
// they always hit the cap. We keep keepalive on small writes (where it buys unload survival) and
// omit it on large ones (where it would cause a false "offline" failure).
/** Exported for tests. Just under the 64 KiB Fetch keepalive spec cap, leaving header headroom. */
export const KEEPALIVE_MAX_BODY_BYTES = 60_000;

/**
 * POSTs a JSON body to an API path and parses the JSON response. `keepalive` is set only when the
 * serialised body is under 60 KB; above that threshold the Fetch spec's 64 KiB keepalive quota
 * would cause fetch() to reject with a TypeError before any bytes leave the device. A write that
 * has not started at unload time still needs `beaconOps` instead - see sync/ops.ts.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const json = JSON.stringify(body);
  // json.length is a byte-accurate measure here because base64 is ASCII (every char is one byte).
  const useKeepalive = json.length < KEEPALIVE_MAX_BODY_BYTES;
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: json,
    keepalive: useKeepalive,
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}
