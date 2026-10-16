import { Moon, Sun } from 'lucide-react';
import { Button } from './ui';

const TABS = [
  { value: 'single', label: 'Обработка' },
  { value: 'batch', label: 'Пакет' },
  { value: 'method', label: 'О методе' },
];

export default function Header({ tab, onTab, batchCount, dark, onTheme, onDemo, demoBusy }) {
  return (
    <header className="shrink-0 border-b border-line bg-surface">
      <div className="flex h-12 items-stretch gap-3 px-3 sm:gap-5 sm:px-4">
        <div className="flex shrink-0 items-center gap-2 font-semibold">
          <img src="/favicon.svg" alt="" className="h-5 w-5" />
          <span className="hidden sm:inline">MicroCleaner</span>
        </div>

        <nav className="flex items-stretch gap-3 sm:gap-4">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => onTab(t.value)}
              className={`focus-ring -mb-px whitespace-nowrap border-b-2 px-0.5 text-sm ${
                tab === t.value ? 'border-accent font-medium text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {t.label}
              {t.value === 'batch' && batchCount > 0 && <span className="ml-1 text-faint">{batchCount}</span>}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={onDemo} busy={demoBusy}>
            <span className="sm:hidden">Пример</span>
            <span className="hidden sm:inline">Открыть пример</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            icon={dark ? Sun : Moon}
            onClick={onTheme}
            title={dark ? 'Светлая тема' : 'Тёмная тема'}
          />
        </div>
      </div>
    </header>
  );
}
