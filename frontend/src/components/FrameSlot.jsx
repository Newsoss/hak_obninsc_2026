import { useRef, useState } from 'react';
import { ACCEPT, frameMeta, isImageFile } from '../lib/files';
import { useI18n } from '../i18n';
import { Spinner } from './ui';

/**
 * Слот для кадра. multiple — можно выбрать несколько файлов сразу (для калибровки:
 * сервер их усреднит); тогда onFile получает массив, иначе — один файл.
 */
const TONES = { raw: 'bg-sky-500', bright: 'bg-amber-400', dark: 'bg-slate-500' };

export default function FrameSlot({ tone, title, frame, busy, optional, multiple, emptyText, onFile, onClear }) {
  const { t } = useI18n();
  const input = useRef(null);
  const [over, setOver] = useState(false);

  const pick = (fileList) => {
    const files = Array.from(fileList || []).filter(isImageFile);
    if (!files.length) return;
    onFile(multiple && files.length > 1 ? files : files[0]);
  };

  let description = emptyText || (optional ? t('slot.optional') : t('slot.empty'));
  if (frame?.estimated) description = t('slot.approximate', { name: frame.name });
  else if (frame?.averaged)
    description = `${frame.name}${frame.averaged.noise_reduction ? t('slot.noise', { n: frame.averaged.noise_reduction }) : ''}`;
  else if (frame)
    description = `${frame.name}, ${frameMeta(frame)}${frame.metadata?.pixel_size ? `, ${frame.metadata.pixel_size}${t('slot.per_px')}` : ''}`;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files);
        }}
        className={`focus-ring flex cursor-pointer items-center gap-2.5 rounded-md border p-1.5 ${
          over ? 'border-accent bg-accent-soft' : frame?.checks?.length ? 'border-warn/60' : 'border-line hover:bg-raised'
        }`}
      >
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple={multiple}
          hidden
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = '';
          }}
        />

        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded border border-line bg-raised">
          {frame && <img src={frame.thumbnail} alt="" className="h-full w-full object-cover" />}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface/70">
              <Spinner className="h-3.5 w-3.5 text-muted" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm">
            {tone && <span className={`h-2 w-2 shrink-0 rounded-full ${TONES[tone]}`} />}
            {title}
          </div>
          <div
            className="truncate text-xs text-muted"
            title={
              frame?.averaged
                ? frame.averaged.files.join(', ')
                : multiple && !frame
                  ? t('slot.multiple')
                  : frame?.name
            }
          >
            {description}
          </div>
        </div>

        {frame && onClear && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="focus-ring rounded px-1 text-xs text-faint hover:text-ink"
          >
            {t('slot.remove')}
          </button>
        )}
      </div>

      {frame?.checks?.map((c) => (
        <p key={c} className="mt-1 text-xs leading-snug text-warn">
          {c}
        </p>
      ))}
    </div>
  );
}
