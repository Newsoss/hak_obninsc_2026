import { useRef, useState } from 'react';
import { ACCEPT, frameMeta, isImageFile } from '../lib/files';
import { Spinner } from './ui';

export default function FrameSlot({ title, frame, busy, optional, onFile, onClear }) {
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
      className={`focus-ring flex cursor-pointer items-center gap-2.5 rounded-md border p-1.5 ${
        over ? 'border-accent bg-accent-soft' : 'border-line hover:bg-raised'
      }`}
    >
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => pick(e.target.files)} />

      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded border border-line bg-raised">
        {frame && <img src={frame.thumbnail} alt="" className="h-full w-full object-cover" />}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/70">
            <Spinner className="h-3.5 w-3.5 text-muted" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-sm">{title}</div>
        <div className="truncate text-xs text-muted" title={frame?.name}>
          {frame
            ? `${frame.name}, ${frameMeta(frame)}`
            : optional
              ? 'Необязательно. Перетащите или нажмите'
              : 'Перетащите файл или нажмите'}
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
          Убрать
        </button>
      )}
    </div>
  );
}
