import { DEFAULT_COLOR, DEFAULT_SETTINGS } from './presets';

const SOFTWARE = 'MicroCleaner 2.0';
const FORMULA = 'C = max(R - D, 0) / max(F - D, 0.01 * mean(F - D)) * mean(F - D)';

const pretty = (data) => JSON.stringify(data, null, 2);

/** Берём из объекта только известные поля нужного типа — чужой JSON не сломает настройки. */
function pick(defaults, source) {
  const out = { ...defaults };
  for (const [key, value] of Object.entries(defaults)) {
    if (source && typeof source[key] === typeof value) out[key] = source[key];
  }
  return out;
}

export function profileJson(settings, presetId) {
  return pretty({ app: 'microcleaner', type: 'profile', version: 1, preset: presetId, settings });
}

/** Принимает файл профиля или журнал обработки (у него тоже есть settings). */
export function parseProfile(text) {
  const data = JSON.parse(text);
  const raw = data?.settings;
  if (!raw || typeof raw !== 'object') throw new Error('в файле нет настроек');
  return {
    presetId: typeof data.preset === 'string' ? data.preset : null,
    settings: { ...pick(DEFAULT_SETTINGS, raw), color: pick(DEFAULT_COLOR, raw.color) },
  };
}

const calibration = (frame) =>
  frame ? { name: frame.name, sha256: frame.sha256, size: `${frame.width}x${frame.height}`, dtype: frame.dtype } : null;

/** Журнал для одного сохранённого файла. */
export function fileLog({ source, result, frames, settings }) {
  return pretty({
    software: SOFTWARE,
    method: 'flat-field correction',
    formula: FORMULA,
    created: new Date().toISOString(),
    source: { name: source.name, sha256: result.report?.source_sha256 ?? source.sha256 ?? null },
    bright_field: calibration(frames.bright),
    dark_field: calibration(frames.dark),
    settings,
    output: { name: result.name, sha256: result.report?.result_sha256 ?? null },
    elapsed_ms: result.report?.elapsed_ms ?? null,
    note: 'Исследовательская обработка. Исходный файл не изменялся и должен храниться отдельно.',
  });
}

/** Журнал серии: калибровка, настройки и итог по каждому файлу. */
export function batchLog(items, frames, settings) {
  return pretty({
    software: SOFTWARE,
    method: 'flat-field correction',
    formula: FORMULA,
    created: new Date().toISOString(),
    bright_field: calibration(frames.bright),
    dark_field: calibration(frames.dark),
    settings,
    files: items.map((it) => ({
      source: { name: it.file.name, sha256: it.result?.report?.source_sha256 ?? null },
      status: it.status,
      output: it.result?.name ?? null,
      result_sha256: it.result?.report?.result_sha256 ?? null,
      elapsed_ms: it.result?.report?.elapsed_ms ?? null,
      error: it.error ?? null,
    })),
    note: 'Исследовательская обработка. Исходные файлы не изменялись и должны храниться отдельно.',
  });
}

export const jsonBlob = (text) => new Blob([text], { type: 'application/json' });
export const logName = (outputName) => outputName.replace(/\.[^.]+$/, '') + '.json';
