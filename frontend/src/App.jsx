import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import {
  averageFrames,
  cropRegion,
  demoCatalog,
  demoFile,
  exportImage,
  fetchPreview,
  probePixel,
  uploadFrame,
} from './api/client';
import { frameMeta, saveBlob } from './lib/files';
import { applyPreset, PRESETS } from './lib/presets';
import { fileLog, jsonBlob, logName, parseProfile, profileJson } from './lib/profile';
import BatchView from './components/BatchView';
import CompareViewer, { maxZoomFor } from './components/CompareViewer';
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
  const [fit, setFit] = useState(1);
  const [detail, setDetail] = useState(null);
  const [pixel, setPixel] = useState(null);
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

  /** file — один файл или массив кадров калибровки (тогда сервер их усредняет). */
  const setFrame = useCallback(
    async (slot, file) => {
      const several = Array.isArray(file);
      setUploading((u) => ({ ...u, [slot]: true }));
      if (several) log(`${SLOT_NAMES[slot]}: усредняю ${file.length} кадров…`);
      try {
        const info = several ? await averageFrames(file, slot) : await uploadFrame(file, slot);
        setFrames((f) => ({ ...f, [slot]: info }));
        const pixelSize = info.metadata?.pixel_size ? `, пиксель ${info.metadata.pixel_size}` : '';
        log(`${SLOT_NAMES[slot]}: ${info.name}, ${frameMeta(info)}${pixelSize}`);
        if (info.averaged) log(`${SLOT_NAMES[slot]}: ${info.averaged.note}`);
        info.checks.forEach((c) => log(`${SLOT_NAMES[slot]}: ${c}`, 'warn'));
      } catch (err) {
        const name = several ? `${file.length} кадров` : file.name;
        log(`${SLOT_NAMES[slot]}: ${name} — ${err.message}`, 'error');
      } finally {
        setUploading((u) => ({ ...u, [slot]: false }));
      }
    },
    [log],
  );

  /** Кадр уже на сервере (например, светлое поле, оцененное по серии в пакете). */
  const setFrameInfo = useCallback(
    (slot, info) => {
      setFrames((f) => ({ ...f, [slot]: info }));
      log(`${SLOT_NAMES[slot]}: ${info.name}`);
      if (info.estimated) log(info.estimated.note, 'warn');
      info.checks.forEach((c) => log(`${SLOT_NAMES[slot]}: ${c}`, 'warn'));
    },
    [log],
  );

  const loadDemo = async () => {
    setDemoBusy(true);
    try {
      const items = await demoCatalog();
      const find = (name) => items.find((i) => i.name === name);
      const sample = items.find((i) => i.name.startsWith('sample-'));
      if (!sample || !find('bright')) throw new Error('в demo_data нет снимка или светлого поля');
      log(`Пример: ${items[0].source_title}`);
      const [raw, bright, darkFrame] = await Promise.all(
        [sample, find('bright'), find('dark')].map((item) => (item ? demoFile(item) : null)),
      );
      await Promise.all([
        setFrame('raw', raw),
        setFrame('bright', bright),
        darkFrame ? setFrame('dark', darkFrame) : setFrames((f) => ({ ...f, dark: null })),
      ]);
      setTab((t) => (t === 'method' ? 'single' : t));
    } catch (err) {
      log(`Пример не загрузился: ${err.message}`, 'error');
    } finally {
      setDemoBusy(false);
    }
  };

  const settingsKey = JSON.stringify(settings);
  const refs = useMemo(
    () =>
      // Без светлого поля сервер оценит его по самому снимку (приблизительно)
      frames.raw
        ? { raw_id: frames.raw.id, bright_id: frames.bright?.id ?? null, dark_id: frames.dark?.id ?? null, settings }
        : null,
    [frames.raw?.id, frames.bright?.id, frames.dark?.id, settingsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const resultKey = refs ? `${refs.raw_id}|${refs.bright_id}|${refs.dark_id}|${settingsKey}` : '';

  // Превью пересчитывается при изменении настроек; устаревшие запросы отменяются
  useEffect(() => {
    if (!refs) {
      setPreview(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const result = await fetchPreview(refs, controller.signal);
        setPreview(result);
        log(`Обработка ${frames.raw.name}: ${result.elapsed_ms.toFixed(0)} мс`);
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
  }, [refs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Новый снимок — детальный участок к нему не относится
  useEffect(() => {
    setDetail(null);
  }, [frames.raw?.id]);

  // Приблизительная коррекция без светлого поля — предупреждаем один раз на снимок.
  // Об оценке по серии уже написано при её получении.
  const approximateKey = preview?.approximate && !frames.bright ? `${frames.raw?.id}|${preview.approximate}` : '';
  useEffect(() => {
    if (approximateKey) log(preview.approximate, 'warn');
  }, [approximateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Предупреждения о калибровке пишем в лог один раз, а не при каждом движении ползунка
  const warningsKey = (preview?.warnings ?? []).join('\n');
  useEffect(() => {
    if (warningsKey) warningsKey.split('\n').forEach((w) => log(w, 'warn'));
  }, [warningsKey, log]);

  // --- Значение пикселя под курсором: не больше одного запроса одновременно ---
  const probe = useRef({ busy: false, next: null });
  const runProbe = useCallback(async () => {
    const state = probe.current;
    if (state.busy || !state.next) return;
    const { point, refs: r } = state.next;
    state.next = null;
    state.busy = true;
    try {
      setPixel(await probePixel(r, point.x, point.y));
    } catch {
      /* проба пикселя необязательна */
    } finally {
      state.busy = false;
      runProbe();
    }
  }, []);

  const onHover = useCallback(
    (p) => {
      if (!p || !refs || !preview) {
        probe.current.next = null;
        setPixel(null);
        return;
      }
      const x = Math.min(preview.width - 1, Math.floor(p.u * preview.width));
      const y = Math.min(preview.height - 1, Math.floor(p.v * preview.height));
      probe.current.next = { point: { x, y }, refs };
      runProbe();
    },
    [refs, preview, runProbe],
  );

  // --- Детальный участок в полном разрешении при сильном увеличении ---
  const viewport = useRef(null);
  const detailTimer = useRef(null);
  const detailCtrl = useRef(null);
  const requestDetail = useCallback(() => {
    clearTimeout(detailTimer.current);
    detailCtrl.current?.abort();
    const vp = viewport.current;
    if (!vp?.needDetail || !refs || !preview) {
      setDetail(null);
      return;
    }
    detailTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      detailCtrl.current = controller;
      const W = preview.width;
      const H = preview.height;
      try {
        const crop = await cropRegion(
          refs,
          {
            x0: Math.floor(vp.u0 * W),
            y0: Math.floor(vp.v0 * H),
            x1: Math.ceil(vp.u1 * W),
            y1: Math.ceil(vp.v1 * H),
            max_side: Math.min(2400, Math.max(64, vp.maxSide)),
          },
          controller.signal,
        );
        setDetail({
          key: resultKey,
          u0: crop.x0 / W,
          v0: crop.y0 / H,
          u1: crop.x1 / W,
          v1: crop.y1 / H,
          before: crop.before,
          after: crop.after,
        });
      } catch (err) {
        if (err.name !== 'AbortError') log(`Детальный просмотр: ${err.message}`, 'error');
      }
    }, 250);
  }, [refs, preview, resultKey, log]);

  const onViewport = useCallback(
    (vp) => {
      viewport.current = vp;
      requestDetail();
    },
    [requestDetail],
  );

  // Настройки изменились — участок перезапрашиваем для текущего вида
  useEffect(() => {
    requestDetail();
  }, [preview]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxZoom = maxZoomFor(fit);
  const actualScale = Math.round(fit * zoom * 100);

  const download = async () => {
    setExporting(true);
    try {
      const result = await exportImage({ ...refs, format: exportFormat || null });
      saveBlob(result.blob, result.name);
      // Журнал рядом с результатом: из чего и с какими настройками он получен
      await new Promise((r) => setTimeout(r, 250));
      saveBlob(jsonBlob(fileLog({ source: frames.raw, result, frames, settings })), logName(result.name));
      log(
        `Сохранено: ${frames.raw.name} → ${result.name} и ${logName(result.name)}, ` +
          `${result.report?.elapsed_ms?.toFixed(0) ?? '?'} мс. Исходный файл не изменён.`,
      );
      if (result.report?.source_metadata) log('Метаданные исходного TIFF перенесены в результат');
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

  const saveProfile = () => {
    saveBlob(jsonBlob(profileJson(settings, presetId)), 'microcleaner-profile.json');
    log('Профиль сохранён в microcleaner-profile.json');
  };

  const loadProfile = async (file) => {
    try {
      const profile = parseProfile(await file.text());
      setSettings(profile.settings);
      setPresetId(PRESETS.some((p) => p.id === profile.presetId) ? profile.presetId : null);
      log(`Профиль загружен из ${file.name}`);
    } catch (err) {
      log(`Не удалось прочитать профиль ${file.name}: ${err.message}`, 'error');
    }
  };

  const openInCompare = (file) => {
    setFrame('raw', file);
    setTab('single');
  };

  const ready = Boolean(frames.raw);
  const emptyHint = frames.bright
    ? 'Загрузите снимок препарата.'
    : 'Загрузите снимок и светлое поле слева или откройте пример. Без светлого поля коррекция будет приблизительной.';

  const status = useMemo(() => {
    if (tab !== 'single' || !preview) return '';
    if (pixel) {
      const values = (v) => v.join(' ');
      const chan = pixel.channels === 'rgb' ? 'RGB ' : '';
      return `x ${pixel.x}, y ${pixel.y} · ${chan}до ${values(pixel.before)} → после ${values(pixel.after)}`;
    }
    const pixelSize = frames.raw?.metadata?.pixel_size ? ` · пиксель ${frames.raw.metadata.pixel_size}` : '';
    return `${preview.width}×${preview.height}, ${preview.dtype}${pixelSize} · обработка ${preview.elapsed_ms.toFixed(0)} мс`;
  }, [tab, preview, pixel, frames.raw]);

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
                multiple
                emptyText="Можно несколько кадров. Без него — приблизительная оценка"
                onFile={(f) => setFrame('bright', f)} onClear={() => setFrames((f) => ({ ...f, bright: null }))} />
              <FrameSlot title="Темновой кадр" optional multiple frame={frames.dark} busy={uploading.dark}
                onFile={(f) => setFrame('dark', f)} onClear={() => setFrames((f) => ({ ...f, dark: null }))} />
            </Section>
            <SettingsPanel
              settings={settings}
              presetId={presetId}
              onChange={changeSettings}
              onPreset={choosePreset}
              onSaveProfile={saveProfile}
              onLoadProfile={loadProfile}
            />
          </aside>

          <section className="order-first flex min-h-[60vh] min-w-0 flex-1 flex-col gap-2 p-3 lg:order-none lg:min-h-0">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented options={VIEW_MODES} value={mode} onChange={setMode} />
              <div className="flex items-center gap-0.5 text-xs text-muted">
                <Button variant="ghost" size="icon" title="Отдалить" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>
                  −
                </Button>
                <button
                  type="button"
                  className="focus-ring w-12 rounded py-1 text-center tabular-nums hover:bg-raised hover:text-ink disabled:pointer-events-none"
                  disabled={!preview || zoom <= 1}
                  onClick={() => setZoom(1)}
                  title="Масштаб относительно реального размера снимка. Нажмите, чтобы вписать в окно"
                >
                  {preview ? `${actualScale}%` : '—'}
                </button>
                <Button variant="ghost" size="icon" title="Приблизить"
                  onClick={() => setZoom((z) => Math.min(maxZoom, z * 1.5))}>
                  +
                </Button>
                <Button variant="ghost" size="sm" disabled={!preview} title="Один пиксель снимка — один пиксель экрана"
                  onClick={() => setZoom(Math.min(maxZoom, Math.max(1, 1 / fit)))}>
                  1:1
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

            <CompareViewer
              preview={preview}
              mode={mode}
              busy={busy}
              zoom={zoom}
              onZoom={setZoom}
              emptyHint={emptyHint}
              onHover={onHover}
              detail={detail?.key === resultKey ? detail : null}
              onViewport={onViewport}
              onFit={setFit}
              approximate={
                preview?.approximate
                  ? frames.bright?.estimated
                    ? 'Светлое поле оценено по серии'
                    : 'Приблизительно: без светлого поля'
                  : null
              }
            />

          </section>
        </main>
      )}

      <div className={tab === 'batch' ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden'}>
        <BatchView
          frames={frames}
          uploading={uploading}
          onFrame={setFrame}
          onFrameInfo={setFrameInfo}
          onClearBright={() => setFrames((f) => ({ ...f, bright: null }))}
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
        {status && <span className="ml-auto truncate tabular-nums">{status}</span>}
      </footer>
    </div>
  );
}
