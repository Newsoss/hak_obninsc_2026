import { Loader2 } from 'lucide-react';
import { translate } from '../i18n';

export function Button({ variant = 'secondary', size = 'md', icon: Icon, busy, className = '', children, ...props }) {
  const variants = {
    primary: 'bg-accent text-on-accent hover:bg-accent/90',
    secondary: 'border border-line bg-surface text-ink hover:bg-raised',
    ghost: 'text-muted hover:bg-raised hover:text-ink',
  };
  const sizes = { sm: 'h-7 px-2.5 text-xs gap-1.5', md: 'h-8 px-3 text-sm gap-1.5', icon: 'h-7 w-7 justify-center' };
  return (
    <button
      type="button"
      className={`focus-ring inline-flex shrink-0 items-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Segmented({ options, value, onChange, className = '' }) {
  return (
    <div className={`inline-flex overflow-hidden rounded-md border border-line bg-surface ${className}`}>
      {options.map(({ value: v, label, title }, i) => (
        <button
          key={v}
          type="button"
          title={title}
          onClick={() => onChange(v)}
          className={`focus-ring flex-1 whitespace-nowrap px-3 py-1 text-xs ${i ? 'border-l border-line' : ''} ${
            value === v ? 'bg-raised font-medium text-ink' : 'text-muted hover:text-ink'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, format = (v) => v, defaultValue }) {
  const fill = ((value - min) / (max - min)) * 100;
  const reset = () => defaultValue !== undefined && onChange(defaultValue);
  return (
    <label className="block" title={translate('slider.reset')}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className={`tabular-nums ${value !== defaultValue ? 'text-ink' : 'text-faint'}`}>{format(value)}</span>
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
        onDoubleClick={reset}
      />
    </label>
  );
}

export function Checkbox({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-accent"
      />
      {label}
    </label>
  );
}

export function Section({ title, action, children, className = '' }) {
  return (
    <section className={`space-y-2.5 ${className}`}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Spinner({ className = 'h-4 w-4' }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}
