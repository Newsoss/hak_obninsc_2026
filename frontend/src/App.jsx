import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import {
  averageFrames,
  cropRegion,
  exportImage,
  fetchPreview,
  probePixel,
  uploadFrame,
} from './api/client';
import { useI18n } from './i18n';
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

const VIEW_MODES = ['split', 'side', 'map'];
const EXPORT_FORMATS = ['', 'tiff', 'png', 'jpeg'];

const DEFAULT_PRESET = PRESETS.find((p) => p.id === 'brightfield');

export default function App() {
  const { t } = useI18n();
  const slotName = (slot) => t(`slot.${slot}`);
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
      if (several) log(t('log.averaging', { slot: slotName(slot), n: file.length }));
      try {
        const info = several ? await averageFrames(file, slot) : await uploadFrame(file, slot);
        setFrames((f) => ({ ...f, [slot]: info }));
        const pixelSize = info.metadata?.pixel_size ? t('log.pixel_size', { size: info.metadata.pixel_size }) : '';
        log(`${slotName(slot)}: ${info.name}, ${frameMeta(info)}${pixelSize}`);
        if (info.averaged) log(`${slotName(slot)}: ${info.averaged.note}`);
        info.checks.forEach((c) => log(`${slotName(slot)}: ${c}`, 'warn'));
      } catch (err) {
        const name = several ? t('log.frames', { n: file.length }) : file.name;
        log(`${slotName(slot)}: ${name} — ${err.message}`, 'error');
      } finally {
        setUploading((u) => ({ ...u, [slot]: false }));
      }
    },
    [log, t], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Кадр уже на сервере (например, светлое поле, оцененное по серии в пакете). */
  const setFrameInfo = useCallback(
    (slot, info) => {
      setFrames((f) => ({ ...f, [slot]: info }));
      log(`${slotName(slot)}: ${info.name}`);
      if (info.estimated) log(info.estimated.note, 'warn');
      info.checks.forEach((c) => log(`${slotName(slot)}: ${c}`, 'warn'));
    },
    [log],
  );

  const settingsKey = JSON.stringify(settings);
  // Что сейчас выбрано в панели (файлы и настройки)
  const currentRefs = useMemo(
    () =>
      // Без светлого поля сервер оценит его по самому снимку (приблизительно)
      frames.raw
        ? { raw_id: frames.raw.id, bright_id: frames.bright?.id ?? null, dark_id: frames.dark?.id ?? null, settings }
        : null,
    [frames.raw?.id, frames.bright?.id, frames.dark?.id, settingsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Что обработано и показано на экране. Ползунки его не меняют — только кнопка «Обработать»
  // или смена файлов. Сохранение, проба пикселя и зум работают с тем, что видно.
  const [refs, setRefs] = useState(null);
  const dirty = Boolean(currentRefs && refs) && JSON.stringify(currentRefs) !== JSON.stringify(refs);
  const runProcessing = useCallback(() => setRefs(currentRefs), [currentRefs]);

  // Новые файлы обрабатываем сразу, чтобы снимок не висел пустым
  useEffect(() => {
    setRefs(currentRefs);
  }, [frames.raw?.id, frames.bright?.id, frames.dark?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+Enter — обработать
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key === 'Enter' && tab === 'single') {
        e.preventDefault();
        runProcessing();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runProcessing, tab]);

  const resultKey = refs ? `${refs.raw_id}|${refs.bright_id}|${refs.dark_id}|${JSON.stringify(refs.settings)}` : '';

  // Превью считается по обработанным настройкам; устаревший запрос отменяется
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
        log(t('log.processed', { name: frames.raw.name, ms: result.elapsed_ms.toFixed(0) }));
      } catch (err) {
        if (err.name !== 'AbortError') log(t('log.preview_error', { error: err.message }), 'error');
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
        if (err.name !== 'AbortError') log(t('log.detail_error', { error: err.message }), 'error');
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
      // Сохраняется то, что обработано и показано, а не несохранённые правки в панели
      saveBlob(result.blob, result.name);
      // Журнал рядом с результатом: из чего и с какими настройками он получен
      await new Promise((r) => setTimeout(r, 250));
      saveBlob(jsonBlob(fileLog({ source: frames.raw, result, frames, settings: refs.settings })), logName(result.name));
      log(
        t('log.saved', {
          src: frames.raw.name,
          out: result.name,
          json: logName(result.name),
          ms: result.report?.elapsed_ms?.toFixed(0) ?? '?',
        }),
      );
      if (result.report?.source_metadata) log(t('log.meta_kept'));
    } catch (err) {
      log(t('log.save_error', { error: err.message }), 'error');
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
    log(t('log.profile_saved', { file: 'microcleaner-profile.json' }));
  };

  const loadProfile = async (file) => {
    try {
      const profile = parseProfile(await file.text());
      setSettings(profile.settings);
      setPresetId(PRESETS.some((p) => p.id === profile.presetId) ? profile.presetId : null);
      log(t('log.profile_loaded', { file: file.name }));
    } catch (err) {
      log(t('log.profile_error', { file: file.name, error: err.message }), 'error');
    }
  };

  const openInCompare = (file) => {
    setFrame('raw', file);
    setTab('single');
  };

  const ready = Boolean(frames.raw);
  const emptyHint = frames.bright ? t('hint.no_raw') : t('hint.empty');

  const status = useMemo(() => {
    if (tab !== 'single' || !preview) return '';
    if (pixel) {
      const values = (v) => v.join(' ');
      const chan = pixel.channels === 'rgb' ? 'RGB ' : '';
      return t('status.pixel', { x: pixel.x, y: pixel.y, chan, before: values(pixel.before), after: values(pixel.after) });
    }
    const pixelSize = frames.raw?.metadata?.pixel_size ? t('status.pixel_size', { size: frames.raw.metadata.pixel_size }) : '';
    const processed = t('status.processed', { ms: preview.elapsed_ms.toFixed(0) });
    return `${preview.width}×${preview.height}, ${preview.dtype}${pixelSize}${processed}`;
  }, [tab, preview, pixel, frames.raw, t]);

  return (
    <div className="flex h-full flex-col">
      <Header
        tab={tab}
        onTab={setTab}
        batchCount={batchCount}
        dark={dark}
        onTheme={() => setDark((d) => !d)}
      />

      {tab === 'single' && (
        <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="space-y-5 border-b border-line bg-surface p-4 lg:w-72 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <Section title={t('section.files')}>
              <FrameSlot tone="raw" title={t('slot.raw')} frame={frames.raw} busy={uploading.raw} onFile={(f) => setFrame('raw', f)} />
              <FrameSlot tone="bright" title={t('slot.bright')} frame={frames.bright} busy={uploading.bright}
                multiple
                emptyText={t('slot.bright_empty')}
                onFile={(f) => setFrame('bright', f)} onClear={() => setFrames((f) => ({ ...f, bright: null }))} />
              <FrameSlot tone="dark" title={t('slot.dark')} optional multiple frame={frames.dark} busy={uploading.dark}
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
              <Segmented options={VIEW_MODES.map((value) => ({ value, label: t(`view.${value}`) }))} value={mode} onChange={setMode} />
              <div className="flex items-center gap-0.5 text-xs text-muted">
                <Button variant="ghost" size="icon" title={t('zoom.out')} onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>
                  −
                </Button>
                <button
                  type="button"
                  className="focus-ring w-12 rounded py-1 text-center tabular-nums hover:bg-raised hover:text-ink disabled:pointer-events-none"
                  disabled={!preview || zoom <= 1}
                  onClick={() => setZoom(1)}
                  title={t('zoom.scale')}
                >
                  {preview ? `${actualScale}%` : '—'}
                </button>
                <Button variant="ghost" size="icon" title={t('zoom.in')}
                  onClick={() => setZoom((z) => Math.min(maxZoom, z * 1.5))}>
                  +
                </Button>
                <Button variant="ghost" size="sm" disabled={!preview} title={t('zoom.one')}
                  onClick={() => setZoom(Math.min(maxZoom, Math.max(1, 1 / fit)))}>
                  1:1
                </Button>
              </div>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {dirty && <span className="text-xs text-warn">{t('process.dirty')}</span>}
                <Button
                  variant={dirty ? 'primary' : 'secondary'}
                  onClick={runProcessing}
                  disabled={!currentRefs || (!dirty && Boolean(preview)) || busy}
                  busy={busy}
                  title={t('process.title')}
                >
                  {t('process.button')}
                </Button>
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}
                  title={t('format.title')}
                  className="field text-xs"
                >
                  {EXPORT_FORMATS.map((value) => (
                    <option key={value} value={value}>
                      {value ? value.toUpperCase() : t('format.source')}
                    </option>
                  ))}
                </select>
                <Button variant={dirty ? 'secondary' : 'primary'} onClick={download} disabled={!ready || !preview} busy={exporting}
                  title={dirty ? t('save.dirty') : undefined}>
                  {t('save.button')}
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
                    ? t('approx.series')
                    : t('approx.none')
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

      <footer className="flex h-6 shrink-0 items-center gap-3 bg-accent px-2 text-xs text-on-accent">
        <button
          type="button"
          onClick={toggleLog}
          title={t('logs.shortcut')}
          className={`flex h-full items-center gap-1.5 px-1.5 hover:bg-white/15 ${logOpen ? 'bg-white/15' : ''}`}
        >
          <SquareTerminal className="h-3.5 w-3.5" />
          {t('logs.button')}
          {unread.count > 0 && (
            <span
              className={`rounded-full px-1.5 text-[10px] leading-4 ${
                unread.errors ? 'bg-bad text-white' : 'bg-white/25 text-on-accent'
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
