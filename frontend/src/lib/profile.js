import { translate } from '../i18n';
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
  if (!raw || typeof raw !== 'object') throw new Error(translate('profile.no_settings'));
  return {
    presetId: typeof data.preset === 'string' ? data.preset : null,
    settings: { ...pick(DEFAULT_SETTINGS, raw), color: pick(DEFAULT_COLOR, raw.color) },
  };
}

const calibration = (frame) =>
  frame
    ? {
        name: frame.name,
        sha256: frame.sha256 || null,
        size: `${frame.width}x${frame.height}`,
        dtype: frame.dtype,
        estimated: frame.estimated ?? undefined,
      }
    : null;



/** Если светлое поле оценено, а не снято, журнал честно говорит, что коррекция приблизительная. */
function approximate(bright) {
  const NOTE = translate('journal.note');
  const note = bright?.estimated?.note;
  return note ? { approximate: true, note: `${note} ${NOTE}` } : { note: NOTE };
}

/** Журнал для одного сохранённого файла. */
export function fileLog({ source, result, frames, settings }) {
  return pretty({
    software: SOFTWARE,
    method: 'flat-field correction',
    formula: FORMULA,
    created: new Date().toISOString(),
    source: {
      name: source.name,
      sha256: result.report?.source_sha256 ?? source.sha256 ?? null,
      metadata: result.report?.source_metadata ?? undefined,
    },
    // Сервер знает, какое светлое поле применил на самом деле (в том числе оценку по снимку)
    bright_field: result.report?.bright_field ?? calibration(frames.bright),
    dark_field: calibration(frames.dark),
    settings,
    output: { name: result.name, sha256: result.report?.result_sha256 ?? null },
    elapsed_ms: result.report?.elapsed_ms ?? null,
    ...approximate(result.report?.bright_field ?? frames.bright),
  });
}

/** Журнал серии: калибровка, настройки и итог по каждому файлу. */
export function batchLog(items, frames, settings, mode = 'shared') {
  // «Для каждого снимка» — светлое поле у каждого файла свое, оценка приблизительная
  const perImage = mode === 'per_image';
  const bright = perImage ? { estimated: { method: 'gaussian', note: translate('journal.per_image') } } : frames.bright;
  return pretty({
    software: SOFTWARE,
    method: 'flat-field correction',
    formula: FORMULA,
    created: new Date().toISOString(),
    calibration: perImage ? 'per_image' : 'shared',
    bright_field: perImage ? null : calibration(frames.bright),
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
    ...approximate(bright),
  });
}

export const jsonBlob = (text) => new Blob([text], { type: 'application/json' });
export const logName = (outputName) => outputName.replace(/\.[^.]+$/, '') + '.json';
