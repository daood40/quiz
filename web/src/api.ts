/** API client with automatic token refresh and typed errors. */

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';

/** Static demo build (GitHub Pages): an in-browser backend replaces the API. */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = localStorage.getItem('accessToken');
let refreshToken: string | null = localStorage.getItem('refreshToken');
let refreshing: Promise<boolean> | null = null;

export function setTokens(access: string | null, refresh: string | null): void {
  accessToken = access;
  refreshToken = refresh;
  try {
    if (access) localStorage.setItem('accessToken', access);
    else localStorage.removeItem('accessToken');
    if (refresh) localStorage.setItem('refreshToken', refresh);
    else localStorage.removeItem('refreshToken');
  } catch {
    /* storage unavailable */
  }
}

export function hasSession(): boolean {
  return IS_DEMO || accessToken !== null;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  retries?: number;
  /** return the response body as a Blob (file downloads) */
  raw?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  if (IS_DEMO) {
    const { demoApi, DemoError } = await import('./demo/demoApi');
    try {
      return (await demoApi(path, { method: opts.method, body: opts.body })) as T;
    } catch (err) {
      if (err instanceof DemoError) throw new ApiError(err.status, err.code, err.message);
      throw err;
    }
  }
  const doFetch = async (): Promise<Response> =>
    fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

  let res: Response;
  const method = (opts.method ?? 'GET').toUpperCase();
  const maxRetries = opts.retries ?? (method === 'GET' || method === 'HEAD' ? 2 : 0);
  let attempt = 0;
  // network-level retry with backoff (transient failures / flaky connections)
  for (;;) {
    try {
      res = await doFetch();
      break;
    } catch {
      if (attempt >= maxRetries) throw new ApiError(0, 'network', 'Network error — check your connection');
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      attempt++;
    }
  }

  if (res.status === 401 && refreshToken && !path.startsWith('/auth/')) {
    if (await tryRefresh()) {
      res = await doFetch();
    } else {
      setTokens(null, null);
      window.dispatchEvent(new Event('auth:expired'));
    }
  }

  if (!res.ok) {
    let payload: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      payload = await res.json();
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(
      res.status,
      payload.error?.code ?? 'error',
      payload.error?.message ?? `Request failed (${res.status})`,
      payload.error?.details,
    );
  }
  if (opts.raw) return (await res.blob()) as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const get = <T = unknown>(path: string) => api<T>(path);
export const post = <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });
