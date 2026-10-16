import { useEffect, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import {
  Archive,
  CheckCircle2,
  Download,
  Eye,
  FileImage,
  Files,
  Layers,
  Play,
  Sparkles,
  Square,
  Trash2,
  Upload,
  AlertTriangle,
} from 'lucide-react';
import { demoFile, processFile } from '../api/client';
import { ACCEPT, browserCanShow, formatBytes, isImageFile, saveBlob } from '../lib/files';
import { PRESETS } from '../lib/presets';
import FrameSlot from './FrameSlot';
import { Button, Segmented, Spinner } from './ui';

const CONCURRENCY = 3;
const FORMATS = [
  { value: '', label: 'Как исходник' },
  { value: 'tiff', label: 'TIFF' },
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
];

let nextId = 1;

function StatusBadge({ item }) {
  if (item.status === 'done')
    return (
      <span className="inline-flex items-center gap-1 text-good">
        <CheckCircle2 className="h-3.5 w-3.5" /> готово
      </span>
    );
  if (item.status === 'processing')
    return (
      <span className="inline-flex items-center gap-1 text-accent">
        <Spinner className="h-3.5 w-3.5" /> обработка
      </span>
    );
  if (item.status === 'error')
    return (
      <span className="inline-flex items-center gap-1 text-bad" title={item.error}>
        <AlertTriangle className="h-3.5 w-3.5" /> ошибка
      </span>
    );
  return <span className="text-faint">в очереди</span>;
}

function buildReport(items) {
  const rows = [['file', 'status', 'output', 'time_ms', 'nonuniformity_before_%', 'nonuniformity_after_%', 'vignetting_before_%', 'vignetting_after_%', 'source_sha256', 'result_sha256', 'error']];
  for (const it of items) {
    const r = it.result?.report;
    rows.push([
      it.file.name,
      it.status,
      it.result?.name ?? '',
      r?.elapsed_ms ?? '',
      r?.before.nonuniformity ?? '',
      r?.after.nonuniformity ?? '',
      r?.before.vignetting ?? '',
      r?.after.vignetting ?? '',
      r?.source_sha256 ?? '',
      r?.result_sha256 ?? '',
      it.error ?? '',
    ]);
  }
  return '﻿' + rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
}

/** Журнал преобразований серии: калибровка, профиль и контрольные суммы каждого файла. */
function buildLog(items, frames, settings) {
  const calib = (f) => (f ? { name: f.name, sha256: f.sha256, size: `${f.width}x${f.height}`, dtype: f.dtype } : null);
  return JSON.stringify(
    {
      software: 'MicroCleaner 2.0',
      method: 'flat-field correction',
      formula: 'C = max(R - D, 0) / max(F - D, 0.01 * mean(F - D)) * mean(F - D)',
      created: new Date().toISOString(),
      bright_field: calib(frames.bright),
      dark_field: calib(frames.dark),
      settings,
      files: items.map((it) => ({
        source: { name: it.file.name, sha256: it.result?.report?.source_sha256 ?? null },
        status: it.status,
        output: it.result?.name ?? null,
        result_sha256: it.result?.report?.result_sha256 ?? null,
        elapsed_ms: it.result?.report?.elapsed_ms ?? null,
        error: it.error ?? null,
      })),
      note: 'Исследовательская обработка. Исходные файлы не изменялись и должны храниться отдельно.',
    },
    null,
    2,
  );
}

export default function BatchView({ frames, uploading, onFrame, onClearDark, settings, presetId, onOpen, onCount, notify }) {
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
    () => () => itemsRef.current.forEach((it) => {
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
      const names = ['sample-1', 'sample-2', 'sample-3', 'sample-4'];
      addFiles(await Promise.all(names.map(demoFile)));
    } catch (err) {
      notify(err.message);
    }
  };

  const run = async () => {
    // Все готово — повторный запуск переобрабатывает серию (например, с новым профилем)
    const pending = itemsRef.current.filter((it) => it.status !== 'done');
    const queue = pending.length ? pending : [...itemsRef.current];
    if (!queue.length || !frames.bright) return;
    stopRef.current = false;
    setRunning(true);
    const started = performance.now();
    const options = { brightId: frames.bright.id, darkId: frames.dark?.id, settings, format };

    const worker = async () => {
      while (queue.length && !stopRef.current) {
        const item = queue.shift();
        patch(item.id, { status: 'processing', error: null });
        try {
          const result = await processFile(item.file, options);
          const resultUrl = browserCanShow(result.blob.type) ? URL.createObjectURL(result.blob) : null;
          patch(item.id, { status: 'done', result, resultUrl });
        } catch (err) {
          patch(item.id, { status: 'error', error: err.message });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setElapsed(performance.now() - started);
    setRunning(false);
  };

  const downloadZip = () => {
    const done = items.filter((it) => it.status === 'done');
    Promise.all(done.map((it) => it.result.blob.arrayBuffer())).then((buffers) => {
      const entries = {};
      done.forEach((it, i) => {
        let name = it.result.name;
        for (let n = 1; entries[name]; n += 1) name = it.result.name.replace(/(\.[^.]+)$/, `_${n}$1`);
        entries[name] = [new Uint8Array(buffers[i]), { level: 0 }];
      });
      entries['report.csv'] = new TextEncoder().encode(buildReport(items));
      entries['processing.json'] = new TextEncoder().encode(buildLog(items, frames, settings));
      saveBlob(new Blob([zipSync(entries)], { type: 'application/zip' }), 'microcleaner_batch.zip');
    });
  };

  // Каждый результат отдельным файлом (*_ffc.*) — оригиналы не перезаписываются
  const downloadFiles = async () => {
    for (const it of items.filter((x) => x.status === 'done')) {
      saveBlob(it.result.blob, it.result.name);
      await new Promise((r) => setTimeout(r, 250));
    }
    saveBlob(new Blob([buildLog(items, frames, settings)], { type: 'application/json' }), 'processing.json');
  };

  const done = items.filter((it) => it.status === 'done');
  const pendingCount = items.length - done.length;
  const failed = items.filter((it) => it.status === 'error').length;
  const progress = items.length ? ((done.length + failed) / items.length) * 100 : 0;
  const avg = (key, field) =>
    done.reduce((s, it) => s + it.result.report[key][field], 0) / Math.max(done.length, 1);
  const preset = PRESETS.find((p) => p.id === presetId);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-5 p-4 lg:grid-cols-[300px_1fr] lg:p-6">
      <aside className="space-y-5">
        <div className="panel space-y-3 p-4">
          <h3 className="label">Калибровка серии</h3>
          <FrameSlot role="bright" title="Светлое поле" hint="Кадр без образца" frame={frames.bright}
            busy={uploading.bright} onFile={(f) => onFrame('bright', f)} />
          <FrameSlot role="dark" title="Темновой кадр" hint="Затвор закрыт" optional frame={frames.dark}
            busy={uploading.dark} onFile={(f) => onFrame('dark', f)} onClear={onClearDark} />
        </div>

        <div className="panel space-y-3 p-4">
          <h3 className="label">Профиль</h3>
          <p className="text-xs leading-relaxed text-muted">
            Ко всем снимкам применяется один профиль из режима «Сравнение»:{' '}
            <span className="font-semibold text-ink">{preset ? preset.name : 'пользовательский'}</span>
            {settings.neutralize_color ? ', нейтрализация оттенка' : ''}
            {settings.smoothing ? `, сглаживание σ ${settings.smoothing}` : ''}.
          </p>
          <div>
            <div className="label mb-1.5">Формат результата</div>
            <Segmented options={FORMATS} value={format} onChange={setFormat} className="w-full" />
          </div>
        </div>
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Layers className="h-5 w-5 text-accent" /> Пакетная обработка
            </h2>
            <p className="text-xs text-muted">Серия снимков одним калибровочным профилем · результат в исходной битности</p>
          </div>
          <Button icon={Sparkles} size="sm" onClick={loadDemo} disabled={running}>Демо-серия</Button>
          {running ? (
            <Button icon={Square} onClick={() => { stopRef.current = true; }}>Стоп</Button>
          ) : (
            <Button
              variant="primary"
              icon={Play}
              onClick={run}
              disabled={!frames.bright || !items.length}
              title={!frames.bright ? 'Сначала загрузите светлое поле' : undefined}
            >
              {pendingCount ? `Обработать ${pendingCount}` : items.length ? 'Обработать заново' : 'Обработать'}
            </Button>
          )}
          <Button icon={Files} onClick={downloadFiles} disabled={!done.length || running} title="Сохранить каждый результат отдельным файлом">
            Файлами
          </Button>
          <Button variant="good" icon={Archive} onClick={downloadZip} disabled={!done.length || running} title="Результаты + report.csv + processing.json">
            ZIP
          </Button>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
          className={`focus-ring flex cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 transition ${
            over ? 'border-accent bg-accent-soft' : 'border-line bg-surface/60 hover:border-accent/60'
          }`}
        >
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <Upload className="h-6 w-6 text-accent" />
          <div>
            <p className="text-sm font-semibold">Перетащите снимки серии или нажмите для выбора</p>
            <p className="text-xs text-muted">TIFF 8/16/32 бит, PNG, JPEG, BMP — сколько угодно файлов</p>
          </div>
        </div>

        {items.length > 0 && (
          <div className="panel overflow-hidden">
            <div className="space-y-2 border-b border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold">
                  {done.length} из {items.length} готово{failed ? ` · ошибок: ${failed}` : ''}
                </span>
                {done.length > 0 && (
                  <span className="font-mono text-muted">
                    неравномерность {avg('before', 'nonuniformity').toFixed(1)}% →{' '}
                    <span className="font-semibold text-good">{avg('after', 'nonuniformity').toFixed(1)}%</span>
                    {elapsed && !running ? ` · ${(elapsed / 1000).toFixed(1)} с` : ''}
                  </span>
                )}
                {!running && (
                  <button type="button" className="text-faint hover:text-bad" onClick={() => items.forEach((it) => remove(it.id))}>
                    очистить
                  </button>
                )}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {items.map((it) => {
                const r = it.result?.report;
                return (
                  <li key={it.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-raised ring-1 ring-line">
                      {it.resultUrl || it.thumb ? (
                        <img src={it.resultUrl || it.thumb} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <FileImage className="m-2.5 h-5 w-5 text-faint" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium" title={it.file.name}>{it.file.name}</p>
                      <p className="truncate font-mono text-[10px] text-faint">
                        {formatBytes(it.file.size)}
                        {it.error ? ` · ${it.error}` : ''}
                      </p>
                    </div>
                    {r && (
                      <div className="hidden text-right font-mono text-[11px] sm:block">
                        <div>
                          <span className="text-faint">{r.before.nonuniformity.toFixed(1)}% → </span>
                          <span className="font-semibold text-good">{r.after.nonuniformity.toFixed(1)}%</span>
                        </div>
                        <div className="text-faint">{r.elapsed_ms.toFixed(0)} мс</div>
                      </div>
                    )}
                    <div className="w-24 text-right font-mono text-[11px]">
                      <StatusBadge item={it} />
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      <Button variant="ghost" size="icon" icon={Eye} title="Открыть в сравнении" onClick={() => onOpen(it.file)} />
                      <Button variant="ghost" size="icon" icon={Download} title="Скачать" disabled={!it.result}
                        onClick={() => saveBlob(it.result.blob, it.result.name)} />
                      <Button variant="ghost" size="icon" icon={Trash2} title="Убрать" disabled={running} onClick={() => remove(it.id)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
