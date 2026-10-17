import { useRef } from 'react';
import { DEFAULT_COLOR, PRESETS } from '../lib/presets';
import { useI18n } from '../i18n';
import { Button, Checkbox, Section, Slider } from './ui';

const signed = (digits) => (v) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;

export default function SettingsPanel({ settings, presetId, onChange, onPreset, onSaveProfile, onLoadProfile }) {
  const { t } = useI18n();
  const fileInput = useRef(null);
  const color = settings.color;
  const setColor = (key) => (value) => onChange({ ...settings, color: { ...color, [key]: value } });

  return (
    <div className="space-y-5">
      <Section title={t('section.profile')}>
        <select
          className="field w-full"
          value={presetId ?? ''}
          onChange={(e) => {
            const preset = PRESETS.find((p) => p.id === e.target.value);
            if (preset) onPreset(preset);
          }}
        >
          {presetId === null && <option value="">{t('preset.custom')}</option>}
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(`preset.${p.id}`)}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 justify-center" onClick={() => fileInput.current?.click()}
            title={t('profile.load_title')}>
            {t('profile.load')}
          </Button>
          <Button size="sm" className="flex-1 justify-center" onClick={onSaveProfile} title={t('profile.save_title')}>
            {t('profile.save')}
          </Button>
        </div>
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
      </Section>

      <Section title={t('section.lighting')}>
        <Checkbox
          label={t('set.neutralize')}
          checked={settings.neutralize_color}
          onChange={(v) => onChange({ ...settings, neutralize_color: v })}
        />
        <Slider
          label={t('set.smoothing')}
          value={settings.smoothing}
          min={0}
          max={20}
          step={0.5}
          defaultValue={0}
          format={(v) => (v ? `${v.toFixed(1)} px` : t('set.off'))}
          onChange={(v) => onChange({ ...settings, smoothing: v })}
        />
      </Section>

      <Section
        title={t('section.color')}
        action={
          <button
            type="button"
            onClick={() => onChange({ ...settings, color: DEFAULT_COLOR })}
            className="focus-ring text-xs text-accent hover:underline"
          >
            {t('set.reset')}
          </button>
        }
      >
        <Checkbox label={t('set.auto_levels')} checked={color.auto_levels} onChange={setColor('auto_levels')} />
        <Checkbox label={t('set.auto_wb')} checked={color.auto_white_balance} onChange={setColor('auto_white_balance')} />
        <div className="space-y-3 pt-1">
          <Slider label={t('set.exposure')} value={color.exposure} min={-2} max={2} step={0.05} defaultValue={0}
            format={(v) => `${signed(2)(v)} EV`} onChange={setColor('exposure')} />
          <Slider label={t('set.brightness')} value={color.brightness} min={-0.5} max={0.5} step={0.01} defaultValue={0}
            format={signed(2)} onChange={setColor('brightness')} />
          <Slider label={t('set.contrast')} value={color.contrast} min={0.5} max={2} step={0.01} defaultValue={1}
            format={(v) => v.toFixed(2)} onChange={setColor('contrast')} />
          <Slider label={t('set.gamma')} value={color.gamma} min={0.4} max={2.5} step={0.01} defaultValue={1}
            format={(v) => v.toFixed(2)} onChange={setColor('gamma')} />
          <Slider label={t('set.saturation')} value={color.saturation} min={0} max={2.5} step={0.01} defaultValue={1}
            format={(v) => v.toFixed(2)} onChange={setColor('saturation')} />
          <Slider label={t('set.temperature')} value={color.temperature} min={-1} max={1} step={0.01} defaultValue={0}
            format={signed(2)} onChange={setColor('temperature')} />
          <Slider label={t('set.tint')} value={color.tint} min={-1} max={1} step={0.01} defaultValue={0}
            format={signed(2)} onChange={setColor('tint')} />
        </div>
      </Section>
    </div>
  );
}
