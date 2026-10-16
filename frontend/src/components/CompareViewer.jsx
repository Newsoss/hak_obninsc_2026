import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Spinner } from './ui';

const GAP = 8;
const MAX_ZOOM = 24;
const TURBO =
  'linear-gradient(90deg,#30123b,#4662d7,#36aaf9,#1ae4b6,#72fe5e,#c8ef34,#faba39,#f66b19,#ca2a04,#7a0403)';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function Label({ children, className = '' }) {
  return (
    <span className={`pointer-events-none absolute z-10 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white ${className}`}>
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
  const fit = Math.min(paneW / iw, paneH / ih) * 0.96;
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

  const stageStyle = () => ({
    width: stageW,
    height: stageH,
    left: paneW / 2 + pan.x - stageW / 2,
    top: paneH / 2 + pan.y - stageH / 2,
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
      className={`relative min-h-[300px] flex-1 touch-none overflow-hidden rounded-md border border-line bg-stage ${cursor}`}
    >
      {preview && mode === 'split' && (
        <div className="absolute inset-0">
          <div ref={stageRef} className="absolute" style={stageStyle()}>
            {img(preview.after, 'После коррекции')}
            {img(preview.before, 'До коррекции', { style: { clipPath: `inset(0 ${100 - split}% 0 0)` } })}
            <div className="absolute inset-y-0 z-10 w-px -translate-x-1/2 bg-white" style={{ left: `${split}%` }}>
              <div
                data-handle
                className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-black/20 bg-white text-zinc-600 shadow"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
                </svg>
              </div>
            </div>
          </div>
          <Label className="left-2 top-2">До</Label>
          <Label className="right-2 top-2">После</Label>
        </div>
      )}

      {preview && mode === 'side' &&
        [
          [preview.before, 'До'],
          [preview.after, 'После'],
        ].map(([src, label], i) => (
          <div key={label} className="absolute inset-y-0 overflow-hidden" style={{ left: i * (paneW + GAP), width: paneW }}>
            <div className="absolute" style={stageStyle()}>{img(src, label)}</div>
            <Label className="left-2 top-2">{label}</Label>
          </div>
        ))}

      {preview && mode === 'map' && (
        <div className="absolute inset-0">
          <div className="absolute" style={stageStyle()}>{img(preview.illumination_map, 'Карта освещённости')}</div>
          <Label className="left-2 top-2">Освещённость по светлому полю</Label>
          <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 w-56 -translate-x-1/2 rounded bg-black/60 px-2 py-1.5 text-white">
            <div className="h-1.5 rounded-sm" style={{ background: TURBO }} />
            <div className="mt-0.5 flex justify-between text-[11px]">
              <span>темнее</span>
              <span>ярче</span>
            </div>
          </div>
        </div>
      )}

      {!preview && !busy && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p className="max-w-xs text-center text-sm text-muted">{emptyHint}</p>
        </div>
      )}

      {busy && (
        <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-xs text-white">
          <Spinner className="h-3 w-3" /> Обработка…
        </div>
      )}
    </div>
  );
}
