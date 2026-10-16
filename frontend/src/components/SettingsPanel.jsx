import { useRef } from 'react';
import { FolderOpen, RotateCcw, Save } from 'lucide-react';
import { DEFAULT_COLOR, PRESETS } from '../lib/presets';
import { Button, Section, Slider, Toggle } from './ui';

const signed = (digits) => (v) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;

export default function SettingsPanel({ settings, presetId, onChange, onPreset, onSaveProfile, onLoadProfile }) {
  const fileInput = useRef(null);
  const color = settings.color;
  const setColor = (key) => (value) => onChange({ ...settings, color: { ...color, [key]: value } });

  return (
    <div className="space-y-6">
      <Section title="Профиль обработки">
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.hint}
              onClick={() => onPreset(p)}
              className={`focus-ring rounded-lg border px-2.5 py-2 text-left transition ${
                presetId === p.id
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line bg-surface text-muted hover:border-faint hover:text-ink'
              }`}
            >
              <span className="block text-xs font-semibold">{p.name}</span>
              <span className="block truncate text-[10px] opacity-75">{p.hint}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" icon={Save} onClick={onSaveProfile} className="flex-1 justify-center">
            Сохранить
          </Button>
          <Button size="sm" icon={FolderOpen} onClick={() => fileInput.current?.click()} className="flex-1 justify-center">
            Загрузить
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onLoadProfile(file);
              e.target.value = '';
            }}
          />
        </div>
      </Section>

      <Section title="Flat-field">
        <Toggle
          label="Нейтрализовать оттенок света"
          hint="Общая нормировка каналов — фон становится серым"
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
          format={(v) => (v ? `σ ${v.toFixed(1)} px` : 'выкл')}
          onChange={(v) => onChange({ ...settings, smoothing: v })}
        />
      </Section>

      <Section
        title="Цветокоррекция"
        action={
          <button
            type="button"
            onClick={() => onChange({ ...settings, color: DEFAULT_COLOR })}
            className="focus-ring inline-flex items-center gap-1 rounded text-[11px] text-faint hover:text-accent"
          >
            <RotateCcw className="h-3 w-3" /> сброс
          </button>
        }
      >
        <div className="space-y-3 rounded-xl border border-line bg-raised/60 p-3">
          <Toggle
            label="Автоуровни"
            hint="Растянуть 0.5–99.5 перцентиль яркости"
            checked={color.auto_levels}
            onChange={setColor('auto_levels')}
          />
          <Toggle
            label="Автобаланс белого"
            hint="Алгоритм «серый мир»"
            checked={color.auto_white_balance}
            onChange={setColor('auto_white_balance')}
          />
        </div>
        <Slider label="Экспозиция" value={color.exposure} min={-2} max={2} step={0.05} defaultValue={0}
          format={(v) => `${signed(2)(v)} EV`} onChange={setColor('exposure')} />
        <Slider label="Яркость" value={color.brightness} min={-0.5} max={0.5} step={0.01} defaultValue={0}
          format={signed(2)} onChange={setColor('brightness')} />
        <Slider label="Контраст" value={color.contrast} min={0.5} max={2} step={0.01} defaultValue={1}
          format={(v) => `×${v.toFixed(2)}`} onChange={setColor('contrast')} />
        <Slider label="Гамма" value={color.gamma} min={0.4} max={2.5} step={0.01} defaultValue={1}
          format={(v) => v.toFixed(2)} onChange={setColor('gamma')} />
        <Slider label="Насыщенность" value={color.saturation} min={0} max={2.5} step={0.01} defaultValue={1}
          format={(v) => `×${v.toFixed(2)}`} onChange={setColor('saturation')} />
        <Slider label="Температура" value={color.temperature} min={-1} max={1} step={0.01} defaultValue={0}
          format={signed(2)} onChange={setColor('temperature')} />
        <Slider label="Оттенок" value={color.tint} min={-1} max={1} step={0.01} defaultValue={0}
          format={signed(2)} onChange={setColor('tint')} />
      </Section>
    </div>
  );
}
