import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { currentLanguage, useI18n } from '../i18n';

const LEVELS = {
  info: { label: 'info', className: 'text-muted' },
  warn: { label: 'warn', className: 'text-warn' },
  error: { label: 'error', className: 'text-bad' },
};

const time = (date) => date.toLocaleTimeString(currentLanguage() === 'en' ? 'en-GB' : 'ru-RU', { hour12: false });

/** Нижняя панель журнала в духе VS Code: тянется за верхний край, очищается, закрывается. */
export default function LogPanel({ logs, height, onResize, onClear, onClose }) {
  const { t } = useI18n();
  const end = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [logs.length]);

  const onPointerDown = (e) => {
    drag.current = { y: e.clientY, h: height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const next = drag.current.h - (e.clientY - drag.current.y);
    onResize(Math.min(Math.max(next, 90), window.innerHeight * 0.7));
  };

  return (
    <div className="relative flex shrink-0 flex-col border-t border-line bg-surface" style={{ height }}>
      <div
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-ns-resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => { drag.current = null; }}
      />
      <div className="flex h-8 shrink-0 items-center gap-3 px-3 text-xs">
        <span className="border-b border-accent pb-0.5 font-medium">{t('logs.title')}</span>
        <span className="text-faint">{logs.length}</span>
        <button type="button" onClick={onClear} className="ml-auto text-muted hover:text-ink" disabled={!logs.length}>
          {t('logs.clear')}
        </button>
        <button type="button" onClick={onClose} title={t('logs.close')} className="text-muted hover:text-ink">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 font-mono text-xs leading-5">
        {logs.length === 0 && <div className="text-faint">{t('logs.empty')}</div>}
        {logs.map((l) => (
          <div key={l.id} className="flex gap-3">
            <span className="shrink-0 text-faint">{time(l.time)}</span>
            <span className={`w-10 shrink-0 ${LEVELS[l.level].className}`}>{LEVELS[l.level].label}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{l.text}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}
