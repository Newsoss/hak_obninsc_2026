import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { Spinner } from './ui';

const GAP = 12;
const MAX_ZOOM = 24;
const TURBO =
  'linear-gradient(90deg,#30123b,#4662d7,#36aaf9,#1ae4b6,#72fe5e,#c8ef34,#faba39,#f66b19,#ca2a04,#7a0403)';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function Tag({ children, tone, className = '' }) {
  const tones = {
    before: 'bg-rose-950/80 text-rose-100 ring-rose-400/30',
    after: 'bg-emerald-950/80 text-emerald-100 ring-emerald-400/30',
    neutral: 'bg-slate-950/75 text-slate-100 ring-white/10',
  };
  return (
    <span
      className={`pointer-events-none absolute z-10 rounded-md px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider ring-1 backdrop-blur ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Окно сравнения: шторка «до/после», два кадра рядом или карта освещения.
 * Колесо — зум к курсору, перетаскивание — панорама, двойной клик — вписать.
 */
export default function CompareViewer({ preview, mode, busy, zoom, onZoom, emptyHint }) {
  const box = useRef(null);
  const stageRef = useRef(null);
  const drag = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [split, setSplit] = useState(50);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const panes = mode === 'side' ? 2 : 1;
  const paneW = Math.max(0, (size.w - GAP * (panes - 1)) / panes);
  const paneH = size.h;
  const iw = preview?.width || 1;
  const ih = preview?.height || 1;
  const fit = Math.min(paneW / iw, paneH / ih) * 0.94;
  const stageW = iw * fit * zoom;
  const stageH = ih * fit * zoom;

  const clampPan = useCallback(
    (p, z = zoom) => {
      const mx = Math.max(0, (iw * fit * z - paneW) / 2 + paneW * 0.25);
      const my = Math.max(0, (ih * fit * z - paneH) / 2 + paneH * 0.25);
      return z <= 1 ? { x: 0, y: 0 } : { x: clamp(p.x, -mx, mx), y: clamp(p.y, -my, my) };
    },
    [iw, ih, fit, paneW, paneH, zoom],
  );

  // Новый снимок — вписываем заново
  useEffect(() => {
    setPan({ x: 0, y: 0 });
    onZoom(1);
  }, [iw, ih]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setPan((p) => clampPan(p)), [zoom, clampPan]);

  // Колесо мыши: зум с сохранением точки под курсором
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!preview) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const local = (e.clientX - rect.left) % (paneW + GAP);
      const cx = local - paneW / 2;
      const cy = e.clientY - rect.top - paneH / 2;
      const next = clamp(zoom * Math.exp(-e.deltaY * 0.0015), 1, MAX_ZOOM);
      const k = next / zoom;
      onZoom(next);
      setPan((p) => clampPan({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }, next));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [preview, zoom, paneW, paneH, clampPan, onZoom]);

  const moveSplit = (clientX) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect) setSplit(clamp(((clientX - rect.left) / rect.width) * 100, 0, 100));
  };

  const onPointerDown = (e) => {
    if (!preview || e.button !== 0) return;
    const onHandle = e.target.closest?.('[data-handle]');
    const splitDrag = mode === 'split' && (onHandle || zoom <= 1);
    drag.current = splitDrag
      ? { type: 'split' }
      : { type: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (splitDrag) moveSplit(e.clientX);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.type === 'split') moveSplit(e.clientX);
    else setPan(clampPan({ x: d.px + e.clientX - d.sx, y: d.py + e.clientY - d.sy }));
  };

  const endDrag = () => {
    drag.current = null;
  };

  const stageStyle = (w = stageW, h = stageH) => ({
    width: w,
    height: h,
    left: paneW / 2 + pan.x - w / 2,
    top: paneH / 2 + pan.y - h / 2,
    // Превью приходит не больше 1600 px — при сильном зуме показываем пиксели честно
    imageRendering: (fit * zoom) / Math.min(1, 1600 / Math.max(iw, ih)) > 2 ? 'pixelated' : 'auto',
  });

  const img = (src, alt, extra = {}) => (
    <img src={src} alt={alt} draggable={false} className="absolute inset-0 h-full w-full select-none" {...extra} />
  );

  const cursor = !preview ? '' : mode === 'split' && zoom <= 1 ? 'cursor-ew-resize' : 'cursor-grab active:cursor-grabbing';

  return (
    <div
      ref={box}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => {
        onZoom(1);
        setPan({ x: 0, y: 0 });
      }}
      className={`checker relative min-h-[320px] flex-1 touch-none overflow-hidden rounded-2xl ring-1 ring-line ${cursor}`}
    >
      {preview && mode === 'split' && (
        <div className="absolute inset-0">
          <div ref={stageRef} className="absolute shadow-2xl" style={stageStyle()}>
            {img(preview.after, 'После коррекции')}
            {img(preview.before, 'До коррекции', { style: { clipPath: `inset(0 ${100 - split}% 0 0)` } })}
            <div className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-white/90 shadow-[0_0_12px_rgba(34,211,238,.9)]" style={{ left: `${split}%` }}>
              <div
                data-handle
                className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border-2 border-white bg-cyan-500/90 text-white shadow-lg backdrop-blur"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" />
                </svg>
              </div>
            </div>
          </div>
          <Tag tone="before" className="left-3 top-3">До · исходник</Tag>
          <Tag tone="after" className="right-3 top-3">После · FFC</Tag>
        </div>
      )}

      {preview && mode === 'side' &&
        [
          [preview.before, 'До · исходник', 'before'],
          [preview.after, 'После · FFC', 'after'],
        ].map(([src, label, tone], i) => (
          <div key={tone} className="absolute inset-y-0 overflow-hidden" style={{ left: i * (paneW + GAP), width: paneW }}>
            <div className="absolute shadow-2xl" style={stageStyle()}>{img(src, label)}</div>
            <Tag tone={tone} className="left-3 top-3">{label}</Tag>
          </div>
        ))}

      {preview && mode === 'map' && (
        <div className="absolute inset-0">
          <div className="absolute shadow-2xl" style={stageStyle()}>{img(preview.illumination_map, 'Карта освещенности')}</div>
          <Tag tone="neutral" className="left-3 top-3">Карта освещенности · светлое поле</Tag>
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 w-64 -translate-x-1/2 rounded-lg bg-slate-950/75 p-2 ring-1 ring-white/10 backdrop-blur">
            <div className="h-2 rounded-full" style={{ background: TURBO }} />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-200">
              <span>темнее</span>
              <span>ярче</span>
            </div>
          </div>
        </div>
      )}

      {!preview && !busy && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface ring-1 ring-line">
            <ImageIcon className="h-6 w-6 text-faint" />
          </div>
          <p className="max-w-sm text-sm text-muted">{emptyHint}</p>
        </div>
      )}

      {busy && (
        <div className="absolute right-3 bottom-3 z-20 flex items-center gap-2 rounded-full bg-slate-950/80 px-3 py-1.5 font-mono text-[11px] text-cyan-200 ring-1 ring-white/10 backdrop-blur">
          <Spinner className="h-3.5 w-3.5" /> расчет коррекции…
        </div>
      )}
    </div>
  );
}
