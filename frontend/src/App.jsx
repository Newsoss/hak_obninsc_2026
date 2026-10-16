import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import { demoFile, exportImage, fetchPreview, uploadFrame } from './api/client';
import { frameMeta, saveBlob } from './lib/files';
import { applyPreset, PRESETS } from './lib/presets';
import BatchView from './components/BatchView';
import CompareViewer from './components/CompareViewer';
import FrameSlot from './components/FrameSlot';
import Header from './components/Header';
import LogPanel from './components/LogPanel';
import MethodView from './components/MethodView';
import SettingsPanel from './components/SettingsPanel';
import { Button, Section, Segmented } from './components/ui';

const VIEW_MODES = [
  { value: 'split', label: 'Шторка' },
  { value: 'side', label: 'Рядом' },
  { value: 'map', label: 'Освещённость' },
];

const EXPORT_FORMATS = [
  { value: '', label: 'Как у исходника' },
  { value: 'tiff', label: 'TIFF' },
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
];

const DEFAULT_PRESET = PRESETS.find((p) => p.id === 'brightfield');
const SLOT_NAMES = { raw: 'Снимок', bright: 'Светлое поле', dark: 'Темновой кадр' };

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
  const [logs, setLogs] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const [logHeight, setLogHeight] = useState(200);
  const [unread, setUnread] = useState({ count: 0, errors: 0 });
  const logOpenRef = useRef(logOpen);
  logOpenRef.current = logOpen;

  const log = useCallback((text, level = 'info') => {
    setLogs((all) => [...all.slice(-499), { id: Math.random(), time: new Date(), level, text }]);
    if (!logOpenRef.current) {
      setUnread((u) => ({ count: u.count + 1, errors: u.errors + (level === 'error' ? 1 : 0) }));
    }
  }, []);

  const toggleLog = useCallback(() => {
    setLogOpen((open) => !open);
    setUnread({ count: 0, errors: 0 });
  }, []);

  // Ctrl+` — как переключение панели в VS Code
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.code === 'Backquote') {
        e.preventDefault();
        toggleLog();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleLog]);

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
        log(`${SLOT_NAMES[slot]}: ${info.name}, ${frameMeta(info)}`);
      } catch (err) {
        log(`${SLOT_NAMES[slot]}: ${file.name} — ${err.message}`, 'error');
      } finally {
        setUploading((u) => ({ ...u, [slot]: false }));
      }
    },
    [log],
  );

  const loadDemo = async () => {
    setDemoBusy(true);
    try {
      const [raw, bright, darkFrame] = await Promise.all(['sample-1', 'bright', 'dark'].map(demoFile));
      await Promise.all([setFrame('raw', raw), setFrame('bright', bright), setFrame('dark', darkFrame)]);
      setTab((t) => (t === 'method' ? 'single' : t));
    } catch (err) {
      log(`Пример не загрузился: ${err.message}`, 'error');
    } finally {
      setDemoBusy(false);
    }
  };

  // Превью пересчитывается при изменении настроек; устаревшие запросы отменяются
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
        if (err.name !== 'AbortError') log(`Превью: ${err.message}`, 'error');
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [frames.raw?.id, frames.bright?.id, frames.dark?.id, settingsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Предупреждения о калибровке пишем в лог один раз, а не при каждом движении ползунка
  const warningsKey = (preview?.warnings ?? []).join('\n');
  useEffect(() => {
    if (warningsKey) warningsKey.split('\n').forEach((w) => log(w, 'warn'));
  }, [warningsKey, log]);

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
      log(`Сохранено: ${frames.raw.name} → ${name}, ${report?.elapsed_ms?.toFixed(0) ?? '?'} мс. Исходный файл не изменён.`);
    } catch (err) {
      log(`Сохранение: ${err.message}`, 'error');
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

  const openInCompare = (file) => {
    setFrame('raw', file);
    setTab('single');
  };

  const ready = frames.raw && frames.bright;
  const emptyHint = useMemo(() => {
    if (!frames.raw && !frames.bright) return 'Загрузите снимок и светлое поле слева или откройте пример.';
    if (!frames.bright) return 'Нужно светлое поле — снимок того же поля зрения без препарата.';
    return 'Загрузите снимок препарата.';
  }, [frames.raw, frames.bright]);

  return (
    <div className="flex h-full flex-col">
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
        <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="space-y-5 border-b border-line bg-surface p-4 lg:w-72 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <Section title="Файлы">
              <FrameSlot title="Снимок" frame={frames.raw} busy={uploading.raw} onFile={(f) => setFrame('raw', f)} />
              <FrameSlot title="Светлое поле" frame={frames.bright} busy={uploading.bright}
                onFile={(f) => setFrame('bright', f)} />
              <FrameSlot title="Темновой кадр" optional frame={frames.dark} busy={uploading.dark}
                onFile={(f) => setFrame('dark', f)} onClear={() => setFrames((f) => ({ ...f, dark: null }))} />
            </Section>
            <SettingsPanel settings={settings} presetId={presetId} onChange={changeSettings} onPreset={choosePreset} />
          </aside>

          <section className="order-first flex min-h-[60vh] min-w-0 flex-1 flex-col gap-2 p-3 lg:order-none lg:min-h-0">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented options={VIEW_MODES} value={mode} onChange={setMode} />
              <div className="flex items-center gap-1 text-xs text-muted">
                <Button variant="ghost" size="icon" title="Отдалить" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>
                  −
                </Button>
                <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                <Button variant="ghost" size="icon" title="Приблизить" onClick={() => setZoom((z) => Math.min(24, z * 1.5))}>
                  +
                </Button>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                  title="Формат файла"
                  className="field text-xs"
                >
                  {EXPORT_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <Button variant="primary" onClick={download} disabled={!ready} busy={exporting}>
                  Сохранить результат
                </Button>
              </div>
            </div>

            <CompareViewer preview={preview} mode={mode} busy={busy} zoom={zoom} onZoom={setZoom} emptyHint={emptyHint} />
          </section>
        </main>
      )}

      <div className={tab === 'batch' ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden'}>
        <BatchView
          frames={frames}
          uploading={uploading}
          onFrame={setFrame}
          onClearDark={() => setFrames((f) => ({ ...f, dark: null }))}
          settings={settings}
          presetId={presetId}
          onOpen={openInCompare}
          onCount={setBatchCount}
          log={log}
        />
      </div>

      {tab === 'method' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MethodView />
        </div>
      )}

      {logOpen && (
        <LogPanel
          logs={logs}
          height={logHeight}
          onResize={setLogHeight}
          onClear={() => setLogs([])}
          onClose={toggleLog}
        />
      )}

      <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface px-2 text-xs text-muted">
        <button
          type="button"
          onClick={toggleLog}
          title="Логи (Ctrl+`)"
          className={`flex h-full items-center gap-1.5 px-1.5 hover:bg-raised hover:text-ink ${logOpen ? 'text-ink' : ''}`}
        >
          <SquareTerminal className="h-3.5 w-3.5" />
          Логи
          {unread.count > 0 && (
            <span
              className={`rounded-full px-1.5 text-[10px] leading-4 ${
                unread.errors ? 'bg-bad text-white' : 'bg-raised text-muted'
              }`}
            >
              {unread.count}
            </span>
          )}
        </button>
        {tab === 'single' && preview && (
          <span className="ml-auto truncate">
            {preview.width}×{preview.height}, {preview.dtype} · обработка {preview.elapsed_ms.toFixed(0)} мс
          </span>
        )}
      </footer>
    </div>
  );
}
