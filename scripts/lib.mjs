// Small HTTP client for the test scripts. Keeps one session cookie per client.
export const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

export class Client {
  constructor(name) {
    this.name = name;
    this.cookie = '';
  }
  async req(method, path, body, headers = {}) {
    const res = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = /pos_session=([^;]*)/.exec(set);
      if (m) this.cookie = m[1] ? `pos_session=${m[1]}` : '';
    }
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, type, headers: res.headers };
  }
  get(p, h) { return this.req('GET', p, undefined, h); }
  post(p, b, h) { return this.req('POST', p, b ?? {}, h); }
  put(p, b) { return this.req('PUT', p, b); }
  patch(p, b) { return this.req('PATCH', p, b); }
  del(p) { return this.req('DELETE', p); }

  async login(username, password, counterId = null) {
    const r = await this.post('/auth/login', { username, password, counterId });
    if (r.status !== 200) throw new Error(`${this.name} login failed: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
}

let passed = 0;
let failed = 0;
export function check(cond, label, extra) {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${extra !== undefined ? `\n       ${typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 600)}` : ''}`);
  }
}
export function results() {
  console.log(`\n${passed} passed, ${failed} failed`);
  return failed;
}
export const uuid = () => crypto.randomUUID();
