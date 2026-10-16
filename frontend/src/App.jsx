import { useCallback, useEffect, useMemo, useState } from 'react';
import { Columns2, Download, Map as MapIcon, Maximize2, SplitSquareHorizontal, X, ZoomIn, ZoomOut } from 'lucide-react';
import { demoFile, exportImage, fetchPreview, uploadFrame } from './api/client';
import { saveBlob } from './lib/files';
import { applyPreset, PRESETS, profileFromJson, profileToJson } from './lib/presets';
import BatchView from './components/BatchView';
import CompareViewer from './components/CompareViewer';
import FrameSlot from './components/FrameSlot';
import Header from './components/Header';
import MethodView from './components/MethodView';
import SettingsPanel from './components/SettingsPanel';
import StatsPanel from './components/StatsPanel';
import { Button, Segmented } from './components/ui';

const VIEW_MODES = [
  { value: 'split', label: 'Шторка', icon: SplitSquareHorizontal },
  { value: 'side', label: 'Рядом', icon: Columns2 },
  { value: 'map', label: 'Освещение', icon: MapIcon },
];

const EXPORT_FORMATS = [
  { value: '', label: 'Формат исходника' },
  { value: 'tiff', label: 'TIFF' },
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
];

const DEFAULT_PRESET = PRESETS.find((p) => p.id === 'brightfield');

export default function App() {
  const [tab, setTab] = useState('single');
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [frames, setFrames] = useState({ raw: null, bright: null, dark: null });
  const [uploading, setUploading] = useState({});
  const [presetId, setPresetId] = useState(DEFAULT_PRESET.id);
  const [settings, setSettings] = useState(() => applyPreset(DEFAULT_PRESET));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('split');
  const [zoom, setZoom] = useState(1);
  const [exportFormat, setExportFormat] = useState('');
  const [exporting, setExporting] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [batchCount, setBatchCount] = useState(0);
  const [toasts, setToasts] = useState([]);

  const notify = useCallback((text, tone = 'error') => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      /* приватный режим */
    }
  }, [dark]);

  const setFrame = useCallback(
    async (slot, file) => {
      setUploading((u) => ({ ...u, [slot]: true }));
      try {
        const info = await uploadFrame(file);
        setFrames((f) => ({ ...f, [slot]: info }));
      } catch (err) {
        notify(err.message);
      } finally {
        setUploading((u) => ({ ...u, [slot]: false }));
      }
    },
    [notify],
  );

  const loadDemo = async () => {
    setDemoBusy(true);
    try {
      const [raw, bright, darkFrame] = await Promise.all(['sample-1', 'bright', 'dark'].map(demoFile));
      await Promise.all([setFrame('raw', raw), setFrame('bright', bright), setFrame('dark', darkFrame)]);
      setTab((t) => (t === 'method' ? 'single' : t));
    } catch (err) {
      notify(err.message);
    } finally {
      setDemoBusy(false);
    }
  };

  // Живое превью: дебаунс + отмена устаревших запросов при движении ползунков
  const settingsKey = JSON.stringify(settings);
  useEffect(() => {
    if (!frames.raw || !frames.bright) {
      setPreview(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const result = await fetchPreview(
          { raw_id: frames.raw.id, bright_id: frames.bright.id, dark_id: frames.dark?.id ?? null, settings },
          controller.signal,
        );
        setPreview(result);
      } catch (err) {
        if (err.name !== 'AbortError') notify(err.message);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [frames.raw?.id, frames.bright?.id, frames.dark?.id, settingsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    setExporting(true);
    try {
      const { blob, name, report } = await exportImage({
        raw_id: frames.raw.id,
        bright_id: frames.bright.id,
        dark_id: frames.dark?.id ?? null,
        settings,
        format: exportFormat || null,
      });
      saveBlob(blob, name);
      notify(
        `Сохранено ${name} · полный размер обработан за ${report?.elapsed_ms?.toFixed(0) ?? '—'} мс. Исходник не изменен.`,
        'info',
      );
    } catch (err) {
      notify(err.message);
    } finally {
      setExporting(false);
    }
  };

  const changeSettings = (next) => {
    setSettings(next);
    setPresetId(null);
  };

  const choosePreset = (preset) => {
    setSettings(applyPreset(preset));
    setPresetId(preset.id);
  };

  const saveProfile = () =>
    saveBlob(new Blob([profileToJson(settings, presetId)], { type: 'application/json' }), 'microcleaner-profile.json');

  const loadProfile = async (file) => {
    try {
      const profile = profileFromJson(await file.text());
      setSettings(profile.settings);
      setPresetId(profile.presetId);
      notify('Профиль загружен', 'info');
    } catch {
      notify('Не удалось прочитать файл профиля');
    }
  };

  const openInCompare = (file) => {
    setFrame('raw', file);
    setTab('single');
  };

  const ready = frames.raw && frames.bright;
  const emptyHint = useMemo(() => {
    if (!frames.raw && !frames.bright) return 'Загрузите исходный снимок и светлое поле — или нажмите «Демо», чтобы увидеть метод в действии.';
    if (!frames.bright) return 'Добавьте светлое поле (bright field) — кадр без образца.';
    return 'Добавьте исходный снимок препарата.';
  }, [frames.raw, frames.bright]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        tab={tab}
        onTab={setTab}
        batchCount={batchCount}
        dark={dark}
        onTheme={() => setDark((d) => !d)}
        onDemo={loadDemo}
        demoBusy={demoBusy}
      />

      {tab === 'single' && (
        <main className="flex flex-1 flex-col gap-4 p-4 lg:h-[calc(100vh-3.5rem)] lg:min-h-0 lg:flex-none lg:flex-row lg:overflow-hidden">
          <aside className="panel space-y-6 p-4 lg:w-[300px] lg:shrink-0 lg:overflow-y-auto">
            <section className="space-y-2">
              <h3 className="label">Кадры</h3>
              <FrameSlot role="raw" title="Исходный снимок" hint="Препарат с артефактами" frame={frames.raw}
                busy={uploading.raw} onFile={(f) => setFrame('raw', f)} />
              <FrameSlot role="bright" title="Светлое поле" hint="Кадр без образца" frame={frames.bright}
                busy={uploading.bright} onFile={(f) => setFrame('bright', f)} />
              <FrameSlot role="dark" title="Темновой кадр" hint="Затвор закрыт" optional frame={frames.dark}
                busy={uploading.dark} onFile={(f) => setFrame('dark', f)}
                onClear={() => setFrames((f) => ({ ...f, dark: null }))} />
            </section>
            <SettingsPanel
              settings={settings}
              presetId={presetId}
              onChange={changeSettings}
              onPreset={choosePreset}
              onSaveProfile={saveProfile}
              onLoadProfile={loadProfile}
            />
          </aside>

          <section className="order-first flex min-h-[60vh] min-w-0 flex-1 flex-col gap-3 lg:order-none lg:min-h-0">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented options={VIEW_MODES} value={mode} onChange={setMode} />
              <div className="flex items-center rounded-xl border border-line bg-surface p-0.5">
                <Button variant="ghost" size="icon" icon={ZoomOut} title="Отдалить" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} />
                <span className="w-12 text-center font-mono text-xs tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
                <Button variant="ghost" size="icon" icon={ZoomIn} title="Приблизить" onClick={() => setZoom((z) => Math.min(24, z * 1.5))} />
                <Button variant="ghost" size="icon" icon={Maximize2} title="Вписать (двойной клик)" onClick={() => setZoom(1)} />
              </div>
              <div className="ml-auto flex items-center gap-2">
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                  title="Формат файла"
                  className="focus-ring h-9 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-ink"
                >
                  {EXPORT_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <Button variant="primary" icon={Download} onClick={download} disabled={!ready} busy={exporting}>
                  Скачать
                </Button>
              </div>
            </div>
            <CompareViewer preview={preview} mode={mode} busy={busy} zoom={zoom} onZoom={setZoom} emptyHint={emptyHint} />
            <p className="hidden text-center font-mono text-[11px] text-faint md:block">
              колесо — зум · перетаскивание — шторка или панорама · двойной клик — вписать
            </p>
            <p className="text-center text-[11px] text-faint">
              Исследовательская обработка: результат сохраняется отдельным файлом *_ffc с журналом параметров, исходник не
              изменяется. Не для диагностики.
            </p>
          </section>

          <aside className="panel p-4 lg:w-[290px] lg:shrink-0 lg:overflow-y-auto">
            <StatsPanel preview={preview} />
          </aside>
        </main>
      )}

      <div className={tab === 'batch' ? 'flex-1' : 'hidden'}>
        <BatchView
          frames={frames}
          uploading={uploading}
          onFrame={setFrame}
          onClearDark={() => setFrames((f) => ({ ...f, dark: null }))}
          settings={settings}
          presetId={presetId}
          onOpen={openInCompare}
          onCount={setBatchCount}
          notify={notify}
        />
      </div>

      {tab === 'method' && <MethodView />}

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-toast pointer-events-auto flex items-start gap-2 rounded-xl border p-3 text-xs shadow-xl backdrop-blur-xl ${
              t.tone === 'error' ? 'border-bad/40 bg-surface/95 text-ink' : 'border-line bg-surface/95 text-ink'
            }`}
          >
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${t.tone === 'error' ? 'bg-bad' : 'bg-good'}`} />
            <span className="flex-1 leading-relaxed">{t.text}</span>
            <button type="button" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} className="text-faint hover:text-ink">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
