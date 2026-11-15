// Browser side of the API. The server is the owner of every consult; this
// file only moves data and turns failures into readable messages.
export interface Upload {
  id: string;
  name: string;
  type: string;
  size: number;
  hasThumb: boolean;
}

export interface Consult {
  id: string;
  ref: string;
  status: 'draft' | 'submitted';
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  profile: { fullName: string; email: string; phone: string; dob: string };
  gender: 'male' | 'female' | null;
  regions: string[];
  theme: string | null;
  idea: string;
  budget: { amount: number; currency: string } | null;
  step: string;
  uploads: Upload[];
  snapshots: { front: string | false; back: string | false };
  email: { sentAt: string; mode: string; ok: boolean } | null;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('No connection. Check your signal and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface RegisterInput {
  fullName: string;
  email: string;
  phone: string;
  dob: string;
  password: string;
  consent: boolean;
}

export const api = {
  me: () => call<{ consult: Consult | null }>('GET', '/api/me'),
  register: (input: RegisterInput) => call<{ consult: Consult }>('POST', '/api/register', input),
  login: (email: string, password: string) => call<{ consult: Consult | null }>('POST', '/api/login', { email, password }),
  logout: () => call<{ ok: true }>('POST', '/api/logout'),
  startAnother: () => call<{ consult: Consult }>('POST', '/api/consults'),
  patch: (patch: Partial<Pick<Consult, 'gender' | 'regions' | 'theme' | 'idea' | 'step'>> & { budget?: { amount: number } | null }) =>
    call<{ consult: Consult }>('PATCH', '/api/consult', patch),
  deleteUpload: (id: string) => call<{ ok: true }>('DELETE', `/api/uploads/${id}`),
  prepare: () =>
    call<{ mode: 'web3forms'; payload: Record<string, string> } | { mode: 'outbox'; previewUrl: string }>('POST', '/api/submit/prepare'),
  confirm: (emailOk: boolean, detail: string) => call<{ consult: Consult }>('POST', '/api/submit/confirm', { emailOk, detail }),

  async snapshot(view: 'front' | 'back', blob: Blob) {
    const res = await fetch(`/api/snapshot?view=${view}`, { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
    if (!res.ok) throw new ApiError((await res.json().catch(() => ({}))).error ?? 'Snapshot failed', res.status);
  },

  /** Uploads one file (plus an optional small preview) with progress. XHR because fetch has no upload progress. */
  upload(file: File, thumb: Blob | null, onProgress: (k: number) => void): Promise<Upload> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      if (thumb) form.append('thumb', thumb, 'thumb.jpg');
      form.append('file', file, file.name);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/uploads');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let data: any = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data.upload);
        else reject(new ApiError(data.error ?? `Upload failed (${xhr.status})`, xhr.status));
      };
      xhr.onerror = () => reject(new ApiError('Upload interrupted. Check your connection.', 0));
      xhr.send(form);
    });
  },

  /** Sends the compiled consult to Web3Forms from the browser (their free plan only accepts browser submissions). */
  async sendWeb3Forms(payload: Record<string, string>) {
    const res = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.success !== false, message: String(data.message ?? res.status) };
  },
};
