import { Loader2 } from 'lucide-react';

export function Button({ variant = 'secondary', size = 'md', icon: Icon, busy, className = '', children, ...props }) {
  const variants = {
    primary: 'bg-accent text-on-accent shadow-lg shadow-accent/25 hover:brightness-110',
    secondary: 'border border-line bg-surface text-ink hover:bg-raised',
    ghost: 'text-muted hover:bg-raised hover:text-ink',
    good: 'bg-good text-white shadow-lg shadow-good/25 hover:brightness-110 dark:text-slate-950',
  };
  const sizes = { sm: 'h-8 px-2.5 text-xs gap-1.5', md: 'h-9 px-3.5 text-sm gap-2', icon: 'h-8 w-8 justify-center' };
  return (
    <button
      type="button"
      className={`focus-ring inline-flex shrink-0 items-center rounded-lg font-medium transition disabled:pointer-events-none disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Segmented({ options, value, onChange, className = '' }) {
  return (
    <div className={`inline-flex rounded-xl border border-line bg-raised p-1 ${className}`}>
      {options.map(({ value: v, label, icon: Icon, title }) => (
        <button
          key={v}
          type="button"
          title={title}
          onClick={() => onChange(v)}
          className={`focus-ring inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            value === v ? 'bg-surface text-accent shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink'
          }`}
        >
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, format = (v) => v, defaultValue }) {
  const fill = ((value - min) / (max - min)) * 100;
  const changed = defaultValue !== undefined && value !== defaultValue;
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <button
          type="button"
          title="Двойной клик — сбросить"
          onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
          className={`font-mono tabular-nums ${changed ? 'text-accent' : 'text-faint'}`}
        >
          {format(value)}
        </button>
      </div>
      <input
        type="range"
        className="range focus-ring"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
      />
    </label>
  );
}

export function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span>
        <span className="block text-xs font-medium text-ink">{label}</span>
        {hint && <span className="block text-[11px] leading-snug text-faint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`focus-ring relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </button>
    </label>
  );
}

export function Section({ title, action, children, className = '' }) {
  return (
    <section className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="label">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Spinner({ className = 'h-4 w-4' }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}
