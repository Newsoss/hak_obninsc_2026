import { BookOpen, Code2, Layers, Moon, SplitSquareHorizontal, Sparkles, Sun } from 'lucide-react';
import { Button, Segmented } from './ui';

const TABS = [
  { value: 'single', label: 'Сравнение', icon: SplitSquareHorizontal },
  { value: 'batch', label: 'Пакет', icon: Layers },
  { value: 'method', label: 'Метод', icon: BookOpen },
];

export default function Header({ tab, onTab, batchCount, dark, onTheme, onDemo, demoBusy }) {
  const tabs = TABS.map((t) => {
    const text = t.value === 'batch' && batchCount ? `${t.label} · ${batchCount}` : t.label;
    return { ...t, title: text, label: <span className="hidden sm:inline">{text}</span> };
  });

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/75 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-8 w-8 rounded-lg shadow-md shadow-accent/30" />
          <div className="hidden min-w-0 sm:block">
            <h1 className="flex items-center gap-2 text-sm font-bold tracking-tight">
              MicroCleaner
              <span className="rounded-full bg-accent-soft px-1.5 py-px font-mono text-[10px] font-semibold text-accent">
                FFC
              </span>
            </h1>
            <p className="truncate text-[11px] text-muted">Выравнивание освещения микроснимков</p>
          </div>
        </div>

        <Segmented options={tabs} value={tab} onChange={onTab} className="mx-auto" />

        <div className="flex items-center gap-1.5">
          <Button icon={Sparkles} size="sm" onClick={onDemo} busy={demoBusy} title="Загрузить демо-набор">
            <span className="hidden md:inline">Демо</span>
          </Button>
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            title="Swagger API"
            className="focus-ring hidden h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-ink sm:inline-flex"
          >
            <Code2 className="h-4 w-4" />
          </a>
          <Button
            variant="ghost"
            size="icon"
            icon={dark ? Sun : Moon}
            onClick={onTheme}
            title={dark ? 'Светлая тема' : 'Темная тема'}
          />
        </div>
      </div>
    </header>
  );
}
