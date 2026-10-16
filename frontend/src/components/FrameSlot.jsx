import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { ACCEPT, frameMeta, isImageFile } from '../lib/files';
import { Spinner } from './ui';

const TONES = {
  raw: 'bg-sky-500',
  bright: 'bg-amber-400',
  dark: 'bg-slate-500',
};

export default function FrameSlot({ role, title, hint, frame, busy, optional, onFile, onClear }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);

  const pick = (files) => {
    const file = Array.from(files || []).find(isImageFile);
    if (file) onFile(file);
  };

  return (
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
      className={`focus-ring group relative flex h-[68px] cursor-pointer items-center gap-3 overflow-hidden rounded-xl border p-2 pr-3 transition ${
        over ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-faint'
      }`}
    >
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => pick(e.target.files)} />

      <div className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg bg-raised ring-1 ring-line">
        {frame ? (
          <img src={frame.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus className="absolute inset-0 m-auto h-5 w-5 text-faint transition group-hover:text-accent" />
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/70">
            <Spinner className="h-4 w-4 text-accent" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${TONES[role]}`} />
          <span className="truncate text-xs font-semibold text-ink">{title}</span>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">
            {optional ? 'опц.' : 'обяз.'}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted" title={frame?.name}>
          {frame ? frame.name : hint}
        </p>
        <p className="truncate font-mono text-[10px] text-faint">{frame ? frameMeta(frame) : 'TIFF · PNG · JPEG'}</p>
      </div>

      {frame && onClear && (
        <button
          type="button"
          title="Убрать"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="focus-ring absolute right-1 top-1 rounded-md p-1 text-faint opacity-0 transition hover:bg-raised hover:text-bad group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
