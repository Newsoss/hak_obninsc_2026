const BASE = import.meta.env.VITE_API_URL ?? '';

async function errorFrom(res) {
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (typeof body.detail === 'string') detail = body.detail;
    else if (Array.isArray(body.detail)) detail = body.detail.map((d) => d.msg).join('; ');
  } catch {
    /* ответ без JSON */
  }
  return new Error(detail);
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(BASE + path, options);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('Сервер недоступен — запущен ли backend на :8000?');
  }
  if (!res.ok) throw await errorFrom(res);
  return res;
}

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function fileResult(res) {
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)/i);
  const report = res.headers.get('X-Correction-Report');
  return {
    blob: await res.blob(),
    name: match ? decodeURIComponent(match[1]) : 'corrected.png',
    report: report ? JSON.parse(report) : null,
    thumbsId: res.headers.get('X-Thumbs-Id'),
  };
}

/** role: raw | bright | dark — сервер проверит калибровочный кадр и вернет замечания в checks. */
export async function uploadFrame(file, role = 'raw') {
  const body = new FormData();
  body.append('file', file);
  return (await request(`/api/frames?role=${role}`, { method: 'POST', body })).json();
}

export async function fetchPreview(refs, signal) {
  return (await request('/api/process/preview', { ...json(refs), signal })).json();
}

export async function exportImage(refs) {
  return fileResult(await request('/api/process/export', json(refs)));
}

/** Значения пикселя до/после в исходных единицах. */
export async function probePixel(refs, x, y, signal) {
  return (await request('/api/process/probe', { ...json({ ...refs, x, y }), signal })).json();
}

/** Участок в полном разрешении для сильного увеличения. */
export async function cropRegion(refs, rect, signal) {
  return (await request('/api/process/crop', { ...json({ ...refs, ...rect }), signal })).json();
}

export async function processFile(file, { brightId, darkId, settings, format, thumbs = false }) {
  const body = new FormData();
  body.append('raw', file);
  body.append('bright_id', brightId);
  if (darkId) body.append('dark_id', darkId);
  body.append('settings', JSON.stringify(settings));
  if (format) body.append('format', format);
  if (thumbs) body.append('thumbs', 'true');
  return fileResult(await request('/api/process/file', { method: 'POST', body }));
}

export async function fetchThumbs(id) {
  return (await request(`/api/thumbs/${id}`)).json();
}

export async function demoFile(name) {
  const blob = await (await request(`/api/demo/${name}.png`)).blob();
  return new File([blob], `demo-${name}.png`, { type: 'image/png' });
}
