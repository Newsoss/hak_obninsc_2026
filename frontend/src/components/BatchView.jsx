import { useEffect, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import { estimateFlat, fetchThumbs, processFile } from '../api/client';
import { contactSheet } from '../lib/canvas';
import { ACCEPT, browserCanShow, formatBytes, isImageFile, saveBlob } from '../lib/files';
import { PRESETS } from '../lib/presets';
import { batchLog, fileLog, jsonBlob, logName } from '../lib/profile';
import { currentLanguage, useI18n } from '../i18n';
import FrameSlot from './FrameSlot';
import { Button, Section, Segmented, Spinner } from './ui';

const CONCURRENCY = 3;
const MIN_SERIES = 5; // столько снимков нужно, чтобы оценить светлое поле по серии
const FORMATS = ['', 'tiff', 'png', 'jpeg'];

let nextId = 1;

function Status({ item }) {
  const { t } = useI18n();
  if (item.status === 'done') return <span className="text-good">{t('status.done')}</span>;
  if (item.status === 'processing')
    return (
      <span className="inline-flex items-center gap-1 text-muted">
        <Spinner className="h-3 w-3" /> {t('status.processing')}
      </span>
    );
  if (item.status === 'error')
    return (
      <span className="text-bad" title={item.error}>
        {t('status.error')}
      </span>
    );
  return <span className="text-faint">{t('status.queued')}</span>;
}

/** Файлы из перетащенных папок (с вложенными) и отдельных файлов. */
async function filesFromDrop(dataTransfer) {
  // webkitGetAsEntry нужно вызвать синхронно, до первого await
  const entries = Array.from(dataTransfer.items || [])
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (!entries.length) return Array.from(dataTransfer.files || []);

  const files = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      files.push(await new Promise((resolve, reject) => entry.file(resolve, reject)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const entry of entries) await walk(entry);
  return files;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default function BatchView({
  frames,
  uploading,
  onFrame,
  onFrameInfo,
  onClearBright,
  onClearDark,
  settings,
  presetId,
  onOpen,
  onCount,
  log,
}) {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [format, setFormat] = useState('');
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const [elapsed, setElapsed] = useState(null);
  const [estimating, setEstimating] = useState(false);
  // shared — одна калибровка на серию; per_image — светлое поле по каждому снимку
  const [calibMode, setCalibMode] = useState('shared');
  const perImage = calibMode === 'per_image';
  const stopRef = useRef(false);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => onCount(items.length), [items.length, onCount]);
  useEffect(
    () => () =>
      itemsRef.current.forEach((it) => {
        if (it.thumb) URL.revokeObjectURL(it.thumb);
      }),
    [],
  );

  const patch = (id, changes) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...changes } : it)));

  const addFiles = (fileList, source = t('batch.src_files')) => {
    const all = Array.from(fileList || []);
    const files = all.filter(isImageFile);
    if (all.length > files.length) log(t('batch.log_skipped', { n: all.length - files.length }), 'warn');
    if (!files.length) return;
    log(t('batch.log_added', { source, n: files.length }));
    setItems((list) => [
      ...list,
      ...files.map((file) => ({
        id: nextId++,
        file,
        path: file.webkitRelativePath || file.name,
        status: 'queued',
        thumb: browserCanShow(file.name) ? URL.createObjectURL(file) : null,
      })),
    ]);
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setOver(false);
    addFiles(await filesFromDrop(e.dataTransfer), t('batch.src_drop'));
  };

  const remove = (id) =>
    setItems((list) => {
      const it = list.find((x) => x.id === id);
      if (it?.thumb) URL.revokeObjectURL(it.thumb);
      return list.filter((x) => x.id !== id);
    });

  /** Светлое поле по снимкам серии (фон в каждой точке) — когда его не снимали. */
  const estimateFromSeries = async () => {
    const files = itemsRef.current.map((it) => it.file);
    if (files.length < MIN_SERIES) {
      log(t('batch.log_need_series', { min: MIN_SERIES, n: files.length }), 'error');
      return null;
    }
    setEstimating(true);
    log(t('batch.log_estimating', { n: files.length }));
    try {
      const info = await estimateFlat(files, frames.dark?.id);
      onFrameInfo('bright', info);
      return info;
    } catch (err) {
      log(t('batch.log_estimate_error', { error: err.message }), 'error');
      return null;
    } finally {
      setEstimating(false);
    }
  };

  const run = async () => {
    // Если всё уже готово — обрабатываем серию заново (например, после смены настроек)
    const pending = itemsRef.current.filter((it) => it.status !== 'done');
    const queue = pending.length ? pending : [...itemsRef.current];
    if (!queue.length) return;
    // Общая калибровка: светлого поля нет — оцениваем его по самой серии.
    // Для каждого снимка: светлое поле не передаем, сервер оценит его по каждому файлу.
    const bright = perImage ? null : frames.bright ?? (await estimateFromSeries());
    if (!perImage && !bright) return;
    stopRef.current = false;
    setRunning(true);
    const started = performance.now();
    const darkNote = frames.dark ? t('batch.log_start_dark', { name: frames.dark.name }) : '';
    log(
      perImage
        ? t('batch.log_start_per_image', { n: queue.length, dark: darkNote })
        : t('batch.log_start', { n: queue.length, bright: bright.name, dark: darkNote }),
    );
    const options = { brightId: bright?.id, darkId: frames.dark?.id, settings, format, thumbs: true };
    const used = { frames: { bright, dark: frames.dark }, settings };

    const worker = async () => {
      while (queue.length && !stopRef.current) {
        const item = queue.shift();
        patch(item.id, { status: 'processing', error: null });
        try {
          const result = await processFile(item.file, options);
          const thumbs = result.thumbsId ? await fetchThumbs(result.thumbsId).catch(() => null) : null;
          patch(item.id, { status: 'done', result, thumbs, used });
          log(t('batch.log_file', { path: item.path, out: result.name, ms: result.report.elapsed_ms.toFixed(0) }));
        } catch (err) {
          patch(item.id, { status: 'error', error: err.message });
          log(`${item.path}: ${err.message}`, 'error');
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const total = performance.now() - started;
    setElapsed(total);
    log(t(stopRef.current ? 'batch.log_stopped' : 'batch.log_done', { s: (total / 1000).toFixed(1) }));
    setRunning(false);
  };

  const itemLog = (it) => fileLog({ source: it.file, result: it.result, ...it.used });

  // Результат и его журнал *_ffc.json — двумя файлами рядом
  const saveItem = async (it) => {
    saveBlob(it.result.blob, it.result.name);
    await wait(250);
    saveBlob(jsonBlob(itemLog(it)), logName(it.result.name));
    log(t('batch.log_saved', { out: it.result.name, json: logName(it.result.name) }));
    await wait(250);
  };

  /** Сводка «до/после» по всей серии одной картинкой. */
  const buildSummary = (finished) => {
    const rows = finished
      .filter((it) => it.thumbs)
      .map((it) => ({
        name: it.path,
        note: t('batch.ms', { ms: it.result.report.elapsed_ms.toFixed(0) }),
        before: it.thumbs.before,
        after: it.thumbs.after,
      }));
    if (!rows.length) return null;
    const preset = presetId ? t(`preset.${presetId}`) : t('preset.custom');
    const calib = [
      perImage ? t('batch.summary_per_image') : frames.bright && t('batch.summary_bright', { name: frames.bright.name }),
      frames.dark && t('batch.summary_dark', { name: frames.dark.name }),
      preset,
      new Date().toLocaleString(currentLanguage() === 'en' ? 'en-GB' : 'ru-RU'),
    ].filter(Boolean);
    return contactSheet(rows, t('batch.summary_heading', { n: rows.length }), calib.join(' · '));
  };

  const downloadSummary = async () => {
    try {
      const blob = await buildSummary(items.filter((it) => it.status === 'done'));
      if (!blob) return;
      saveBlob(blob, 'microcleaner_summary.png');
      log(t('batch.log_summary', { file: 'microcleaner_summary.png' }));
    } catch (err) {
      log(t('batch.log_summary_error', { error: err.message }), 'error');
    }
  };

  const downloadZip = async () => {
    const finished = items.filter((it) => it.status === 'done');
    try {
      const buffers = await Promise.all(finished.map((it) => it.result.blob.arrayBuffer()));
      const entries = {};
      finished.forEach((it, i) => {
        let name = it.result.name;
        for (let n = 1; entries[name]; n += 1) name = it.result.name.replace(/(\.[^.]+)$/, `_${n}$1`);
        entries[name] = [new Uint8Array(buffers[i]), { level: 0 }];
        entries[logName(name)] = new TextEncoder().encode(itemLog(it));
      });
      entries['processing.json'] = new TextEncoder().encode(batchLog(items, frames, settings, calibMode));
      const summary = await buildSummary(finished);
      if (summary) entries['summary.png'] = [new Uint8Array(await summary.arrayBuffer()), { level: 0 }];
      saveBlob(new Blob([zipSync(entries)], { type: 'application/zip' }), 'microcleaner_batch.zip');
      log(t('batch.log_zip', { file: 'microcleaner_batch.zip', n: finished.length }));
    } catch (err) {
      log(`ZIP: ${err.message}`, 'error');
    }
  };

  // Каждый результат отдельным файлом (*_ffc.*) — оригиналы не перезаписываются
  const downloadFiles = async () => {
    for (const it of items.filter((x) => x.status === 'done')) {
      await saveItem(it);
    }
  };

  const done = items.filter((it) => it.status === 'done');
  const pendingCount = items.length - done.length;
  const failed = items.filter((it) => it.status === 'error').length;
  const progress = items.length ? ((done.length + failed) / items.length) * 100 : 0;
  const preset = PRESETS.find((p) => p.id === presetId);
  const presetLabel = preset ? t(`preset.${preset.id}`).toLowerCase() : t('preset.custom').toLowerCase();

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 p-4 lg:grid-cols-[260px_1fr] lg:p-6">
      <aside className="space-y-5">
        <Section title={t('batch.calibration')}>
          <Segmented
            className="w-full"
            value={calibMode}
            onChange={setCalibMode}
            options={[
              { value: 'shared', label: t('batch.mode_shared'), title: t('batch.mode_shared_title') },
              { value: 'per_image', label: t('batch.mode_per_image'), title: t('batch.mode_per_image_title') },
            ]}
          />
          {perImage ? (
            <p className="text-xs text-muted">{t('batch.per_image_note')}</p>
          ) : (
          <FrameSlot tone="bright" title={t('slot.bright')} multiple frame={frames.bright} busy={uploading.bright || estimating}
            emptyText={t('batch.bright_empty', { min: MIN_SERIES })}
            onFile={(f) => onFrame('bright', f)} onClear={onClearBright} />
          )}
          <FrameSlot tone="dark" title={t('slot.dark')} optional multiple frame={frames.dark} busy={uploading.dark}
            onFile={(f) => onFrame('dark', f)} onClear={onClearDark} />
          {!perImage && !frames.bright && (
            <div className="space-y-1.5">
              <Button size="sm" className="w-full justify-center" onClick={estimateFromSeries}
                disabled={running || estimating || items.length < MIN_SERIES} busy={estimating}
                title={t('batch.estimate_title')}>
                {t('batch.estimate')}
              </Button>
            </div>
          )}
        </Section>

        <Section title={t('batch.settings')}>
          <p className="text-xs text-muted">
            {t('batch.settings_from', {
              preset: presetLabel,
              neutral: settings.neutralize_color ? t('batch.neutral') : '',
              smooth: settings.smoothing ? t('batch.smooth', { px: settings.smoothing }) : '',
            })}
          </p>
          <label className="block text-xs text-muted">
            {t('batch.format')}
            <select className="field mt-1 w-full" value={format} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS.map((value) => (
                <option key={value} value={value}>
                  {value ? value.toUpperCase() : t('format.source')}
                </option>
              ))}
            </select>
          </label>
        </Section>
      </aside>

      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-base font-semibold">{t('batch.title')}</h2>
          <Button size="sm" onClick={() => fileInput.current?.click()} disabled={running}>
            {t('batch.add_files')}
          </Button>
          <Button size="sm" onClick={() => folderInput.current?.click()} disabled={running}
            title={t('batch.add_folder_title')}>
            {t('batch.add_folder')}
          </Button>
          {running ? (
            <Button size="sm" onClick={() => { stopRef.current = true; }}>
              {t('batch.stop')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={run}
              disabled={estimating || !items.length || (!perImage && !frames.bright && items.length < MIN_SERIES)}
              title={
                perImage || frames.bright
                  ? undefined
                  : items.length < MIN_SERIES
                    ? t('batch.need_bright', { min: MIN_SERIES })
                    : t('batch.will_estimate')
              }
            >
              {pendingCount || !items.length ? t('batch.process') : t('batch.reprocess')}
            </Button>
          )}
        </div>

        <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={folderInput} type="file" multiple hidden webkitdirectory=""
          onChange={(e) => { addFiles(e.target.files, t('batch.src_folder')); e.target.value = ''; }} />

        {!items.length ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={`rounded-md border border-dashed p-10 text-center text-sm text-muted ${
              over ? 'border-accent bg-accent-soft' : 'border-line'
            }`}
          >
            {t('batch.drop')}
            <br />
            {t('batch.drop_note')}
          </div>
        ) : (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="overflow-hidden rounded-md border border-line bg-surface"
          >
            <table className="w-full table-fixed text-sm">
              <thead className="border-b border-line bg-raised text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('batch.th_file')}</th>
                  <th className="hidden w-20 px-3 py-2 font-medium sm:table-cell">{t('batch.th_size')}</th>
                  <th className="hidden w-20 px-3 py-2 font-medium sm:table-cell">{t('batch.th_time')}</th>
                  <th className="hidden w-24 px-3 py-2 font-medium sm:table-cell">{t('batch.th_status')}</th>
                  <th className="w-40 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((it) => {
                  const preview = it.thumbs?.after || it.thumb;
                  return (
                    <tr key={it.id}>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 shrink-0 overflow-hidden rounded border border-line bg-raised">
                            {preview && <img src={preview} alt="" className="h-full w-full object-cover" />}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate" title={it.error || it.path}>
                              {it.path}
                            </div>
                            {/* На телефоне статус — под именем, отдельных колонок не хватает места */}
                            <div className="text-xs sm:hidden">
                              <Status item={it} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 text-muted sm:table-cell">{formatBytes(it.file.size)}</td>
                      <td className="hidden whitespace-nowrap px-3 tabular-nums text-muted sm:table-cell">
                        {it.result ? t('batch.ms', { ms: it.result.report.elapsed_ms.toFixed(0) }) : '—'}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 text-xs sm:table-cell">
                        <Status item={it} />
                      </td>
                      <td className="whitespace-nowrap px-3 text-right text-xs">
                        <button type="button" className="text-accent hover:underline" onClick={() => onOpen(it.file)}>
                          {t('batch.open')}
                        </button>
                        {it.result && (
                          <button type="button" className="ml-3 text-accent hover:underline" onClick={() => saveItem(it)}>
                            {t('batch.download')}
                          </button>
                        )}
                        {!running && (
                          <button type="button" className="ml-3 text-faint hover:text-bad" title={t('batch.remove')}
                            onClick={() => remove(it.id)}>
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {items.length > 0 && (
          <div className="space-y-2">
            <div className="h-1 overflow-hidden rounded bg-line">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="mr-auto">
                {t('batch.progress', { done: done.length, total: items.length })}
                {failed ? t('batch.failed', { n: failed }) : ''}
                {elapsed && !running ? t('batch.seconds', { s: (elapsed / 1000).toFixed(1) }) : ''}
              </span>
              <Button size="sm" onClick={downloadSummary} disabled={!done.length || running}
                title={t('batch.summary_title')}>
                {t('batch.summary')}
              </Button>
              <Button size="sm" onClick={downloadFiles} disabled={!done.length || running}>
                {t('batch.download_each')}
              </Button>
              <Button size="sm" onClick={downloadZip} disabled={!done.length || running}
                title={t('batch.zip_title')}>
                {t('batch.zip')}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
