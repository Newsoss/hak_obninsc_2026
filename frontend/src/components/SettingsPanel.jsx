import { DEFAULT_COLOR, PRESETS } from '../lib/presets';
import { Checkbox, Section, Slider } from './ui';

const signed = (digits) => (v) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;

export default function SettingsPanel({ settings, presetId, onChange, onPreset }) {
  const color = settings.color;
  const setColor = (key) => (value) => onChange({ ...settings, color: { ...color, [key]: value } });

  return (
    <div className="space-y-5">
      <Section title="Пресет">
        <select
          className="field w-full"
          value={presetId ?? ''}
          onChange={(e) => {
            const preset = PRESETS.find((p) => p.id === e.target.value);
            if (preset) onPreset(preset);
          }}
        >
          {presetId === null && <option value="">Свои настройки</option>}
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Коррекция освещения">
        <Checkbox
          label="Убрать оттенок осветителя"
          checked={settings.neutralize_color}
          onChange={(v) => onChange({ ...settings, neutralize_color: v })}
        />
        <Slider
          label="Сглаживание светлого поля"
          value={settings.smoothing}
          min={0}
          max={20}
          step={0.5}
          defaultValue={0}
          format={(v) => (v ? `${v.toFixed(1)} px` : 'нет')}
          onChange={(v) => onChange({ ...settings, smoothing: v })}
        />
      </Section>

      <Section
        title="Цвет"
        action={
          <button
            type="button"
            onClick={() => onChange({ ...settings, color: DEFAULT_COLOR })}
            className="focus-ring text-xs text-accent hover:underline"
          >
            Сбросить
          </button>
        }
      >
        <Checkbox label="Автоуровни" checked={color.auto_levels} onChange={setColor('auto_levels')} />
        <Checkbox label="Автобаланс белого" checked={color.auto_white_balance} onChange={setColor('auto_white_balance')} />
        <div className="space-y-3 pt-1">
          <Slider label="Экспозиция" value={color.exposure} min={-2} max={2} step={0.05} defaultValue={0}
            format={(v) => `${signed(2)(v)} EV`} onChange={setColor('exposure')} />
          <Slider label="Яркость" value={color.brightness} min={-0.5} max={0.5} step={0.01} defaultValue={0}
            format={signed(2)} onChange={setColor('brightness')} />
          <Slider label="Контраст" value={color.contrast} min={0.5} max={2} step={0.01} defaultValue={1}
            format={(v) => v.toFixed(2)} onChange={setColor('contrast')} />
          <Slider label="Гамма" value={color.gamma} min={0.4} max={2.5} step={0.01} defaultValue={1}
            format={(v) => v.toFixed(2)} onChange={setColor('gamma')} />
          <Slider label="Насыщенность" value={color.saturation} min={0} max={2.5} step={0.01} defaultValue={1}
            format={(v) => v.toFixed(2)} onChange={setColor('saturation')} />
          <Slider label="Температура" value={color.temperature} min={-1} max={1} step={0.01} defaultValue={0}
            format={signed(2)} onChange={setColor('temperature')} />
          <Slider label="Оттенок" value={color.tint} min={-1} max={1} step={0.01} defaultValue={0}
            format={signed(2)} onChange={setColor('tint')} />
        </div>
      </Section>
    </div>
  );
}
