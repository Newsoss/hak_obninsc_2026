import { translate } from '../i18n';

// Пути запросов уже начинаются с /api, поэтому здесь только адрес сервера.
// В dev (npm run dev) запросы идут через прокси Vite на локальный бэкенд.
const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? 'https://microcleaner.duckdns.org' : '');

// Язык интерфейса — сервер отвечает на нем (предупреждения, ошибки, журнал)
let apiLanguage = 'ru';
export function setApiLanguage(lang) {
  apiLanguage = lang;
}

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

const pause = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

async function request(path, options = {}) {
  // 429 — сервер занят или лимит запросов: ждем, сколько он просит, и повторяем
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(BASE + path, {
        ...options,
        headers: { ...(options.headers || {}), 'Accept-Language': apiLanguage },
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new Error(translate('api.offline'));
    }
    if (res.status === 429 && attempt < 5) {
      const wait = Math.min(10, Number(res.headers.get('Retry-After')) || 1);
      await pause(wait * 1000 * (attempt + 1), options.signal);
      continue;
    }
    if (!res.ok) throw await errorFrom(res);
    return res;
  }
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

/** Среднее нескольких кадров светлого поля или темнового кадра (master flat / master dark). */
export async function averageFrames(files, role) {
  const body = new FormData();
  files.forEach((file) => body.append('files', file));
  return (await request(`/api/frames/average?role=${role}`, { method: 'POST', body })).json();
}

/** Проверка метода на эталоне: встроенный снимок или свой чистый снимок. */
export async function verifyMethod(file) {
  const body = new FormData();
  if (file) body.append('file', file);
  return (await request('/api/verify', { method: 'POST', body })).json();
}

/** Светлое поле, оцененное по серии снимков (когда его не снимали). */
const MAX_SERIES = 64; // сервер больше не использует — незачем гонять лишние файлы

export async function estimateFlat(files, darkId) {
  const step = Math.max(1, files.length / MAX_SERIES);
  const picked = files.length > MAX_SERIES ? Array.from({ length: MAX_SERIES }, (_, i) => files[Math.floor(i * step)]) : files;
  const body = new FormData();
  picked.forEach((file) => body.append('files', file));
  if (darkId) body.append('dark_id', darkId); // вычитается из снимков до оценки
  const info = await (await request('/api/flat/series', { method: 'POST', body })).json();
  // Оценка привязана к темновому кадру: при его смене она устаревает
  return { ...info, darkId: darkId ?? null };
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
  if (brightId) body.append('bright_id', brightId); // без него — оценка по каждому снимку
  if (darkId) body.append('dark_id', darkId);
  body.append('settings', JSON.stringify(settings));
  if (format) body.append('format', format);
  if (thumbs) body.append('thumbs', 'true');
  return fileResult(await request('/api/process/file', { method: 'POST', body }));
}

export async function fetchThumbs(id) {
  return (await request(`/api/thumbs/${id}`)).json();
}
