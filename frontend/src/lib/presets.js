export const DEFAULT_COLOR = {
  exposure: 0,
  brightness: 0,
  contrast: 1,
  gamma: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  auto_white_balance: false,
  auto_levels: false,
};

export const DEFAULT_SETTINGS = {
  neutralize_color: true,
  smoothing: 0,
  color: DEFAULT_COLOR,
};

export const PRESETS = [
  { id: 'ffc', name: 'Только FFC', hint: 'Чистое выравнивание без цветокоррекции', color: {} },
  {
    id: 'brightfield',
    name: 'Светлое поле',
    hint: 'Автоуровни и мягкий контраст',
    color: { auto_levels: true, contrast: 1.05, saturation: 1.1 },
  },
  {
    id: 'histology',
    name: 'Гистология',
    hint: 'Сочные красители H&E, глубокие ядра',
    color: { auto_levels: true, contrast: 1.15, saturation: 1.4, gamma: 0.95 },
  },
  {
    id: 'fluorescence',
    name: 'Флуоресценция',
    hint: 'Темный фон, яркие метки',
    neutralize_color: false,
    color: { exposure: 0.5, contrast: 1.3, gamma: 1.25, saturation: 1.2 },
  },
];

export function applyPreset(preset) {
  return {
    ...DEFAULT_SETTINGS,
    neutralize_color: preset.neutralize_color ?? true,
    color: { ...DEFAULT_COLOR, ...preset.color },
  };
}

/** Сохранение / загрузка профиля обработки (настройки без калибровочных кадров). */
export function profileToJson(settings, presetId) {
  return JSON.stringify({ app: 'microcleaner', version: 2, preset: presetId, settings }, null, 2);
}

export function profileFromJson(text) {
  const data = JSON.parse(text);
  const settings = data.settings ?? data;
  if (typeof settings !== 'object' || settings === null) throw new Error('Неверный файл профиля');
  return {
    presetId: data.preset ?? null,
    settings: {
      ...DEFAULT_SETTINGS,
      ...settings,
      color: { ...DEFAULT_COLOR, ...(settings.color || {}) },
    },
  };
}
