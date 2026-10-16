import { useEffect, useRef } from 'react';
import { AlertTriangle, Clock, Gauge, ScanLine } from 'lucide-react';
import { Section } from './ui';

const CHANNELS = {
  r: [239, 68, 68],
  g: [16, 185, 129],
  b: [59, 130, 246],
  l: [148, 163, 184],
};

function Histogram({ data, label }) {
  const canvas = useRef(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !data) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    el.width = w * dpr;
    el.height = h * dpr;
    const ctx = el.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Корень сжимает пики фона и делает видимыми хвосты распределения
    const series = Object.entries(data).map(([k, v]) => [k, v.map(Math.sqrt)]);
    const peak = Math.max(1, ...series.flatMap(([, v]) => v));
    ctx.globalCompositeOperation = document.documentElement.classList.contains('dark') ? 'lighter' : 'multiply';

    for (const [key, values] of series) {
      const [r, g, b] = CHANNELS[key];
      const step = w / (values.length - 1);
      ctx.beginPath();
      ctx.moveTo(0, h);
      values.forEach((v, i) => ctx.lineTo(i * step, h - (v / peak) * (h - 2)));
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = `rgba(${r},${g},${b},0.35)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${r},${g},${b},0.9)`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }, [data]);

  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <canvas ref={canvas} className="block h-14 w-full rounded-lg bg-raised ring-1 ring-line" />
    </div>
  );
}

function Metric({ icon: Icon, label, before, after, unit, better, hint }) {
  const improved = better === 'lower' ? after < before : Math.abs(after - 100) < Math.abs(before - 100);
  return (
    <div className="rounded-xl border border-line bg-surface p-3" title={hint}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
        <span className="text-sm text-faint line-through decoration-faint/50">
          {before.toFixed(1)}
          {unit}
        </span>
        <span className="text-faint">→</span>
        <span className={`text-lg font-semibold ${improved ? 'text-good' : 'text-warn'}`}>
          {after.toFixed(1)}
          {unit}
        </span>
      </div>
    </div>
  );
}

export default function StatsPanel({ preview }) {
  if (!preview) {
    return (
      <div className="rounded-xl border border-dashed border-line p-4 text-xs leading-relaxed text-faint">
        Здесь появятся время обработки, метрики равномерности освещения и гистограммы.
      </div>
    );
  }

  const { before, after } = preview.metrics;
  const gain = before.nonuniformity / Math.max(after.nonuniformity, 0.01);

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 p-4 text-white shadow-lg shadow-cyan-500/20">
        <div className="text-[11px] font-medium uppercase tracking-wider text-white/75">Равномерность фона</div>
        <div className="mt-1 text-3xl font-bold tabular-nums">{gain >= 1 ? `×${gain.toFixed(gain < 10 ? 1 : 0)}` : '—'}</div>
        <div className="text-xs text-white/80">
          {gain >= 1 ? 'во столько раз ровнее освещение' : 'освещение не стало ровнее'}
        </div>
        <ScanLine className="absolute -right-3 -top-3 h-24 w-24 text-white/10" />
      </div>

      <Section title="Метрики">
        <div className="grid grid-cols-1 gap-2">
          <Metric
            icon={Gauge}
            label="Неравномерность освещения"
            before={before.nonuniformity}
            after={after.nonuniformity}
            unit="%"
            better="lower"
            hint="Коэффициент вариации сглаженного поля яркости. Меньше — лучше."
          />
          <Metric
            icon={ScanLine}
            label="Углы / центр (виньетирование)"
            before={before.vignetting}
            after={after.vignetting}
            unit="%"
            better="hundred"
            hint="Яркость углов относительно центра. 100% — виньетирования нет."
          />
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <div className="rounded-lg bg-raised px-2.5 py-2 ring-1 ring-line">
            <div className="flex items-center gap-1 text-faint">
              <Clock className="h-3 w-3" /> расчет превью
            </div>
            <div className="mt-0.5 text-sm font-semibold text-ink">{preview.elapsed_ms.toFixed(1)} мс</div>
          </div>
          <div className="rounded-lg bg-raised px-2.5 py-2 ring-1 ring-line">
            <div className="text-faint">исходник</div>
            <div className="mt-0.5 truncate text-sm font-semibold text-ink">
              {preview.width}×{preview.height}
            </div>
            <div className="text-faint">{preview.dtype}</div>
          </div>
        </div>
      </Section>

      <Section title="Гистограммы">
        <Histogram data={preview.histograms.before} label="до" />
        <Histogram data={preview.histograms.after} label="после" />
      </Section>

      {preview.warnings?.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-warn/40 bg-warn/10 p-3 text-[11px] text-ink">
          {preview.warnings.map((w) => (
            <p key={w} className="flex gap-1.5">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warn" /> {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
