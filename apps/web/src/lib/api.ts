/** Thin fetch wrapper for /api/v1. Session lives in an http-only cookie, so nothing is stored in the browser. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get code() {
    return this.data.code as string | undefined;
  }
  get errors() {
    return (this.data.errors as string[] | undefined) ?? [];
  }
}

type Listener = (status: number, code?: string) => void;
const listeners = new Set<Listener>();
/** Lets the app react to 401 (logged out) and forced password changes from anywhere. */
export function onAuthProblem(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; form?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the store server. Check the network cable or Wi-Fi and try again.');
  }
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    const err = new ApiError(res.status, (data as { message?: string }).message ?? `Request failed (${res.status})`, data as Record<string, unknown>);
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/verify-password')) listeners.forEach((l) => l(401));
    if (res.status === 403 && err.code === 'PASSWORD_CHANGE_REQUIRED') listeners.forEach((l) => l(403, err.code));
    if (res.status === 423) listeners.forEach((l) => l(423, err.code));
    throw err;
  }
  return data as T;
}

export const get = <T>(p: string) => api<T>(p);
export const post = <T>(p: string, body: unknown = {}, headers?: Record<string, string>) => api<T>(p, { method: 'POST', body, headers });
export const put = <T>(p: string, body: unknown) => api<T>(p, { method: 'PUT', body });
export const patch = <T>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body });
export const del = <T>(p: string) => api<T>(p, { method: 'DELETE' });

/** Download a PDF or Excel file from the API and save it with the server's file name. */
export async function download(path: string) {
  const res = await fetch(`/api/v1${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (data as { message?: string }).message ?? 'Download failed', data);
  }
  const disp = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disp)?.[1] ?? 'download';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}
