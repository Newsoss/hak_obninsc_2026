import { useI18n } from '../i18n';
import VerifyPanel from './VerifyPanel';

function H({ children }) {
  return <h3 className="mb-2 mt-8 text-base font-semibold">{children}</h3>;
}

export default function MethodView() {
  const { t } = useI18n();
  return (
    <article className="mx-auto max-w-2xl px-4 py-8 leading-relaxed text-ink">
      <h2 className="text-xl font-semibold">{t('method.title')}</h2>
      <p className="mt-3 text-muted">{t('method.intro')}</p>

      <H>{t('method.formula')}</H>
      <pre className="overflow-x-auto rounded-md border border-line bg-surface px-4 py-3 font-mono text-sm">
        C = (R − D) / (F − D) × m
      </pre>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
        <li><b className="text-ink">R</b> — {t('method.r')}</li>
        <li><b className="text-ink">F</b> — {t('method.f')}</li>
        <li><b className="text-ink">D</b> — {t('method.d')}</li>
        <li><b className="text-ink">m</b> — {t('method.m')}</li>
      </ul>

      <H>{t('method.verify')}</H>
      <VerifyPanel />

      <H>{t('method.limits')}</H>
      <p className="text-muted">{t('method.limits_text')}</p>

    </article>
  );
}
