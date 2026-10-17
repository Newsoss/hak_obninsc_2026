import { Moon, Sun } from 'lucide-react';
import { useI18n } from '../i18n';
import { Button } from './ui';

const TABS = ['single', 'batch', 'method'];

export default function Header({ tab, onTab, batchCount, dark, onTheme }) {
  const { lang, setLang, t } = useI18n();
  return (
    <header className="shrink-0 border-b border-line bg-surface">
      <div className="flex h-12 items-stretch gap-3 px-3 sm:gap-5 sm:px-4">
        {/* На самых узких телефонах (до 360 px) логотип прячем — иначе вкладки не помещаются */}
        <div className="hidden shrink-0 items-center gap-2 font-semibold min-[360px]:flex">
          <img src="/icon.svg" alt="" className="h-9 w-9" />
          <span className="hidden sm:inline">MicroCleaner</span>
        </div>

        <nav className="flex items-stretch gap-3 sm:gap-4">
          {TABS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onTab(value)}
              className={`focus-ring -mb-px whitespace-nowrap border-b-2 px-0.5 text-sm ${
                tab === value ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {t(`tab.${value}`)}
              {value === 'batch' && batchCount > 0 && <span className="ml-1 text-faint">{batchCount}</span>}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          {/* Язык — так же, как тема: одна кнопка-переключатель */}
          <Button
            variant="ghost"
            size="sm"
            className="w-9 justify-center font-medium"
            onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
            title={t('lang.switch')}
          >
            {lang === 'ru' ? 'EN' : 'RU'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            icon={dark ? Sun : Moon}
            onClick={onTheme}
            title={dark ? t('theme.light') : t('theme.dark')}
          />
        </div>
      </div>
    </header>
  );
}
