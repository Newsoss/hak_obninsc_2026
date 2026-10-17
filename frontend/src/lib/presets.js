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

// Название пресета — в словаре: t(`preset.${id}`)
export const PRESETS = [
  { id: 'ffc', color: {} },
  { id: 'brightfield', color: { auto_levels: true, contrast: 1.05, saturation: 1.1 } },
  { id: 'histology', color: { auto_levels: true, contrast: 1.15, saturation: 1.4, gamma: 0.95 } },
  {
    id: 'fluorescence',

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
