import { useEffect, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import { estimateFlat, fetchThumbs, processFile } from '../api/client';
import { contactSheet } from '../lib/canvas';
import { ACCEPT, browserCanShow, formatBytes, isImageFile, saveBlob } from '../lib/files';
import { PRESETS } from '../lib/presets';
import { batchLog, fileLog, jsonBlob, logName } from '../lib/profile';
import FrameSlot from './FrameSlot';
import { Button, Section, Spinner } from './ui';

const CONCURRENCY = 3;
const MIN_SERIES = 5; // столько снимков нужно, чтобы оценить светлое поле медианой
const FORMATS = [
  { value: '', label: 'Как у исходника' },
  { value: 'tiff', label: 'TIFF' },
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
];

let nextId = 1;

function Status({ item }) {
  if (item.status === 'done') return <span className="text-good">Готово</span>;
  if (item.status === 'processing')
    return (
      <span className="inline-flex items-center gap-1 text-muted">
        <Spinner className="h-3 w-3" /> Обработка
      </span>
    );
  if (item.status === 'error')
    return (
      <span className="text-bad" title={item.error}>
        Ошибка
      </span>
    );
  return <span className="text-faint">Ожидает</span>;
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
  const [items, setItems] = useState([]);
  const [format, setFormat] = useState('');
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const [elapsed, setElapsed] = useState(null);
  const [estimating, setEstimating] = useState(false);
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

  const addFiles = (fileList, source = 'файлы') => {
    const all = Array.from(fileList || []);
    const files = all.filter(isImageFile);
    if (all.length > files.length) log(`Пропущено ${all.length - files.length} файл(ов) не в формате TIFF/PNG/JPEG/BMP`, 'warn');
    if (!files.length) return;
    log(`Добавлено в пакет (${source}): ${files.length}`);
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
    addFiles(await filesFromDrop(e.dataTransfer), 'перетаскивание');
  };

  const remove = (id) =>
    setItems((list) => {
      const it = list.find((x) => x.id === id);
      if (it?.thumb) URL.revokeObjectURL(it.thumb);
      return list.filter((x) => x.id !== id);
    });

  /** Светлое поле как медиана по снимкам серии — когда его не снимали. */
  const estimateFromSeries = async () => {
    const files = itemsRef.current.map((it) => it.file);
    if (files.length < MIN_SERIES) {
      log(`Чтобы оценить светлое поле по серии, нужно минимум ${MIN_SERIES} снимков (сейчас ${files.length})`, 'error');
      return null;
    }
    setEstimating(true);
    log(`Оцениваю светлое поле по серии из ${files.length} снимков (медиана)…`);
    try {
      const info = await estimateFlat(files);
      onFrameInfo('bright', info);
      return info;
    } catch (err) {
      log(`Оценка светлого поля: ${err.message}`, 'error');
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
    // Светлого поля нет — оцениваем его по самой серии
    const bright = frames.bright ?? (await estimateFromSeries());
    if (!bright) return;
    stopRef.current = false;
    setRunning(true);
    const started = performance.now();
    log(`Пакет: обработка ${queue.length} файл(ов), светлое поле ${bright.name}${frames.dark ? `, темновой кадр ${frames.dark.name}` : ''}`);
    const options = { brightId: bright.id, darkId: frames.dark?.id, settings, format, thumbs: true };
    const used = { frames: { bright, dark: frames.dark }, settings };

    const worker = async () => {
      while (queue.length && !stopRef.current) {
        const item = queue.shift();
        patch(item.id, { status: 'processing', error: null });
        try {
          const result = await processFile(item.file, options);
          const thumbs = result.thumbsId ? await fetchThumbs(result.thumbsId).catch(() => null) : null;
          patch(item.id, { status: 'done', result, thumbs, used });
          log(`${item.path} → ${result.name}, ${result.report.elapsed_ms.toFixed(0)} мс`);
        } catch (err) {
          patch(item.id, { status: 'error', error: err.message });
          log(`${item.path}: ${err.message}`, 'error');
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const total = performance.now() - started;
    setElapsed(total);
    log(`Пакет ${stopRef.current ? 'остановлен' : 'готов'} за ${(total / 1000).toFixed(1)} с`);
    setRunning(false);
  };

  const itemLog = (it) => fileLog({ source: it.file, result: it.result, ...it.used });

  // Результат и его журнал *_ffc.json — двумя файлами рядом
  const saveItem = async (it) => {
    saveBlob(it.result.blob, it.result.name);
    await wait(250);
    saveBlob(jsonBlob(itemLog(it)), logName(it.result.name));
    log(`Сохранено: ${it.result.name} и ${logName(it.result.name)}`);
    await wait(250);
  };

  /** Сводка «до/после» по всей серии одной картинкой. */
  const buildSummary = (finished) => {
    const rows = finished
      .filter((it) => it.thumbs)
      .map((it) => ({
        name: it.path,
        note: `${it.result.report.elapsed_ms.toFixed(0)} мс`,
        before: it.thumbs.before,
        after: it.thumbs.after,
      }));
    if (!rows.length) return null;
    const preset = PRESETS.find((p) => p.id === presetId)?.name ?? 'свои настройки';
    const calib = [
      frames.bright && `светлое поле ${frames.bright.name}`,
      frames.dark && `темновой кадр ${frames.dark.name}`,
      preset,
      new Date().toLocaleString('ru-RU'),
    ].filter(Boolean);
    return contactSheet(rows, `MicroCleaner — серия из ${rows.length} снимков`, calib.join(' · '));
  };

  const downloadSummary = async () => {
    try {
      const blob = await buildSummary(items.filter((it) => it.status === 'done'));
      if (!blob) return;
      saveBlob(blob, 'microcleaner_summary.png');
      log('Сводка до/после сохранена: microcleaner_summary.png');
    } catch (err) {
      log(`Сводка: ${err.message}`, 'error');
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
      entries['processing.json'] = new TextEncoder().encode(batchLog(items, frames, settings));
      const summary = await buildSummary(finished);
      if (summary) entries['summary.png'] = [new Uint8Array(await summary.arrayBuffer()), { level: 0 }];
      saveBlob(new Blob([zipSync(entries)], { type: 'application/zip' }), 'microcleaner_batch.zip');
      log(`Сохранён microcleaner_batch.zip: ${finished.length} файл(ов), журналы *_ffc.json, processing.json и summary.png`);
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

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 p-4 lg:grid-cols-[260px_1fr] lg:p-6">
      <aside className="space-y-5">
        <Section title="Калибровка">
          <FrameSlot title="Светлое поле" multiple frame={frames.bright} busy={uploading.bright || estimating}
            emptyText={`Нет — оценим по серии (от ${MIN_SERIES} снимков)`}
            onFile={(f) => onFrame('bright', f)} onClear={onClearBright} />
          <FrameSlot title="Темновой кадр" optional multiple frame={frames.dark} busy={uploading.dark}
            onFile={(f) => onFrame('dark', f)} onClear={onClearDark} />
          {!frames.bright && (
            <div className="space-y-1.5">
              <Button size="sm" className="w-full justify-center" onClick={estimateFromSeries}
                disabled={running || estimating || items.length < MIN_SERIES} busy={estimating}
                title="Светлое поле = медиана по снимкам серии. Работает, если препарат на снимках в разных местах">
                Оценить по серии
              </Button>
              <p className="text-xs text-muted">
                Светлое поле не снимали? При {MIN_SERIES} и более снимках разных полей зрения оно будет оценено
                по серии — каждый участок кадра берётся там, где на нём нет препарата.
              </p>
            </div>
          )}
        </Section>

        <Section title="Настройки">
          <p className="text-xs text-muted">
            Берутся со вкладки «Обработка»: {preset ? preset.name.toLowerCase() : 'свои настройки'}
            {settings.neutralize_color ? ', без оттенка осветителя' : ''}
            {settings.smoothing ? `, сглаживание ${settings.smoothing} px` : ''}.
          </p>
          <label className="block text-xs text-muted">
            Формат файлов
            <select className="field mt-1 w-full" value={format} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </Section>
      </aside>

      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-base font-semibold">Пакетная обработка</h2>
          <Button size="sm" onClick={() => fileInput.current?.click()} disabled={running}>
            Добавить файлы
          </Button>
          <Button size="sm" onClick={() => folderInput.current?.click()} disabled={running}
            title="Все снимки из папки, включая вложенные">
            Добавить папку
          </Button>
          {running ? (
            <Button size="sm" onClick={() => { stopRef.current = true; }}>
              Остановить
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={run}
              disabled={estimating || !items.length || (!frames.bright && items.length < MIN_SERIES)}
              title={
                frames.bright
                  ? undefined
                  : items.length < MIN_SERIES
                    ? `Загрузите светлое поле или добавьте минимум ${MIN_SERIES} снимков`
                    : 'Светлое поле будет оценено по серии'
              }
            >
              {pendingCount || !items.length ? 'Обработать' : 'Обработать заново'}
            </Button>
          )}
        </div>

        <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={folderInput} type="file" multiple hidden webkitdirectory=""
          onChange={(e) => { addFiles(e.target.files, 'папка'); e.target.value = ''; }} />

        {!items.length ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={`rounded-md border border-dashed p-10 text-center text-sm text-muted ${
              over ? 'border-accent bg-accent-soft' : 'border-line'
            }`}
          >
            Перетащите сюда снимки серии или целую папку (TIFF, PNG, JPEG).
            <br />
            Ко всем применяются одна калибровка и одни настройки.
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
                  <th className="px-3 py-2 font-medium">Файл</th>
                  <th className="hidden w-20 px-3 py-2 font-medium sm:table-cell">Размер</th>
                  <th className="w-20 px-3 py-2 font-medium">Время</th>
                  <th className="w-24 px-3 py-2 font-medium">Статус</th>
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
                          <span className="truncate" title={it.error || it.path}>
                            {it.path}
                          </span>
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 text-muted sm:table-cell">{formatBytes(it.file.size)}</td>
                      <td className="whitespace-nowrap px-3 tabular-nums text-muted">
                        {it.result ? `${it.result.report.elapsed_ms.toFixed(0)} мс` : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 text-xs">
                        <Status item={it} />
                      </td>
                      <td className="whitespace-nowrap px-3 text-right text-xs">
                        <button type="button" className="text-accent hover:underline" onClick={() => onOpen(it.file)}>
                          Открыть
                        </button>
                        {it.result && (
                          <button type="button" className="ml-3 text-accent hover:underline" onClick={() => saveItem(it)}>
                            Скачать
                          </button>
                        )}
                        {!running && (
                          <button type="button" className="ml-3 text-faint hover:text-bad" title="Убрать из списка"
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
                Готово {done.length} из {items.length}
                {failed ? `, с ошибкой ${failed}` : ''}
                {elapsed && !running ? ` · ${(elapsed / 1000).toFixed(1)} с` : ''}
              </span>
              <Button size="sm" onClick={downloadSummary} disabled={!done.length || running}
                title="Все снимки серии «до / после» на одной картинке">
                Сводка до/после
              </Button>
              <Button size="sm" onClick={downloadFiles} disabled={!done.length || running}>
                Скачать по одному
              </Button>
              <Button size="sm" onClick={downloadZip} disabled={!done.length || running}
                title="Результаты, их журналы, processing.json и сводка до/после">
                Скачать ZIP
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
