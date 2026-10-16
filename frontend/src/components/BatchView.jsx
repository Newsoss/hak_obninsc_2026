import { useEffect, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import { demoFile, processFile } from '../api/client';
import { ACCEPT, browserCanShow, formatBytes, isImageFile, saveBlob } from '../lib/files';
import { PRESETS } from '../lib/presets';
import { batchLog, fileLog, jsonBlob, logName } from '../lib/profile';
import FrameSlot from './FrameSlot';
import { Button, Section, Spinner } from './ui';

const CONCURRENCY = 3;
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

export default function BatchView({ frames, uploading, onFrame, onClearDark, settings, presetId, onOpen, onCount, log }) {
  const [items, setItems] = useState([]);
  const [format, setFormat] = useState('');
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const [elapsed, setElapsed] = useState(null);
  const stopRef = useRef(false);
  const input = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => onCount(items.length), [items.length, onCount]);
  useEffect(
    () => () =>
      itemsRef.current.forEach((it) => {
        if (it.thumb) URL.revokeObjectURL(it.thumb);
        if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
      }),
    [],
  );

  const patch = (id, changes) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...changes } : it)));

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []).filter(isImageFile);
    if (!files.length) return;
    setItems((list) => [
      ...list,
      ...files.map((file) => ({
        id: nextId++,
        file,
        status: 'queued',
        thumb: browserCanShow(file.name) ? URL.createObjectURL(file) : null,
      })),
    ]);
  };

  const remove = (id) =>
    setItems((list) => {
      const it = list.find((x) => x.id === id);
      if (it?.thumb) URL.revokeObjectURL(it.thumb);
      if (it?.resultUrl) URL.revokeObjectURL(it.resultUrl);
      return list.filter((x) => x.id !== id);
    });

  const loadDemo = async () => {
    try {
      addFiles(await Promise.all(['sample-1', 'sample-2', 'sample-3'].map(demoFile)));
    } catch (err) {
      log(`Примеры не загрузились: ${err.message}`, 'error');
    }
  };

  const run = async () => {
    // Если всё уже готово — обрабатываем серию заново (например, после смены настроек)
    const pending = itemsRef.current.filter((it) => it.status !== 'done');
    const queue = pending.length ? pending : [...itemsRef.current];
    if (!queue.length || !frames.bright) return;
    stopRef.current = false;
    setRunning(true);
    const started = performance.now();
    log(`Пакет: обработка ${queue.length} файл(ов), светлое поле ${frames.bright.name}${frames.dark ? `, темновой кадр ${frames.dark.name}` : ''}`);
    const options = { brightId: frames.bright.id, darkId: frames.dark?.id, settings, format };

    const worker = async () => {
      while (queue.length && !stopRef.current) {
        const item = queue.shift();
        patch(item.id, { status: 'processing', error: null });
        try {
          const result = await processFile(item.file, options);
          const resultUrl = browserCanShow(result.blob.type) ? URL.createObjectURL(result.blob) : null;
          patch(item.id, { status: 'done', result, resultUrl, used: { frames: { bright: frames.bright, dark: frames.dark }, settings } });
          log(`${item.file.name} → ${result.name}, ${result.report.elapsed_ms.toFixed(0)} мс`);
        } catch (err) {
          patch(item.id, { status: 'error', error: err.message });
          log(`${item.file.name}: ${err.message}`, 'error');
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
    await new Promise((r) => setTimeout(r, 250));
    saveBlob(jsonBlob(itemLog(it)), logName(it.result.name));
    log(`Сохранено: ${it.result.name} и ${logName(it.result.name)}`);
    await new Promise((r) => setTimeout(r, 250));
  };

  const downloadZip = () => {
    const finished = items.filter((it) => it.status === 'done');
    Promise.all(finished.map((it) => it.result.blob.arrayBuffer())).then((buffers) => {
      const entries = {};
      finished.forEach((it, i) => {
        let name = it.result.name;
        for (let n = 1; entries[name]; n += 1) name = it.result.name.replace(/(\.[^.]+)$/, `_${n}$1`);
        entries[name] = [new Uint8Array(buffers[i]), { level: 0 }];
      });
      entries['processing.json'] = new TextEncoder().encode(batchLog(items, frames, settings));
      finished.forEach((it) => {
        entries[logName(it.result.name)] = new TextEncoder().encode(itemLog(it));
      });
      saveBlob(new Blob([zipSync(entries)], { type: 'application/zip' }), 'microcleaner_batch.zip');
      log(`Сохранён microcleaner_batch.zip: ${finished.length} файл(ов), их журналы *_ffc.json и processing.json`);
    });
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
          <FrameSlot title="Светлое поле" frame={frames.bright} busy={uploading.bright} onFile={(f) => onFrame('bright', f)} />
          <FrameSlot title="Темновой кадр" optional frame={frames.dark} busy={uploading.dark}
            onFile={(f) => onFrame('dark', f)} onClear={onClearDark} />
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
          <Button size="sm" onClick={() => input.current?.click()} disabled={running}>
            Добавить файлы
          </Button>
          <Button size="sm" onClick={loadDemo} disabled={running}>
            Добавить примеры
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
              disabled={!frames.bright || !items.length}
              title={!frames.bright ? 'Сначала загрузите светлое поле' : undefined}
            >
              {pendingCount || !items.length ? 'Обработать' : 'Обработать заново'}
            </Button>
          )}
        </div>

        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />

        {!items.length ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
            className={`rounded-md border border-dashed p-10 text-center text-sm text-muted ${
              over ? 'border-accent bg-accent-soft' : 'border-line'
            }`}
          >
            Перетащите сюда снимки серии (TIFF, PNG, JPEG) или нажмите «Добавить файлы».
            <br />
            Ко всем применяются одна калибровка и одни настройки.
          </div>
        ) : (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
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
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 shrink-0 overflow-hidden rounded border border-line bg-raised">
                          {(it.resultUrl || it.thumb) && (
                            <img src={it.resultUrl || it.thumb} alt="" className="h-full w-full object-cover" />
                          )}
                        </div>
                        <span className="truncate" title={it.error || it.file.name}>
                          {it.file.name}
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
                        <button type="button" className="ml-3 text-accent hover:underline"
                          onClick={() => saveItem(it)}>
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
                ))}
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
              <Button size="sm" onClick={downloadFiles} disabled={!done.length || running}>
                Скачать по одному
              </Button>
              <Button size="sm" onClick={downloadZip} disabled={!done.length || running} title="Результаты, их журналы и processing.json">
                Скачать ZIP
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
