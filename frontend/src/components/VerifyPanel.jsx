import { useRef, useState } from 'react';
import { verifyMethod } from '../api/client';
import { ACCEPT } from '../lib/files';
import { useI18n } from '../i18n';
import { Button } from './ui';

const IMAGES = ['truth', 'raw', 'corrected'];

/**
 * Проверка метода на эталоне: известный чистый снимок «снимается» с виньетированием,
 * пылью и оттенком, исправляется и сравнивается с оригиналом — в числах.
 */
export default function VerifyPanel() {
  const { t } = useI18n();
  const input = useRef(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async (file) => {
    setBusy(true);
    setError(null);
    try {
      setResult(await verifyMethod(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-3">
      <p className="text-muted">{t('verify.intro')}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => run(null)} busy={busy}>
          {t('verify.run')}
        </Button>
        <Button size="sm" onClick={() => input.current?.click()} disabled={busy}
          title={t('verify.own_title')}>
          {t('verify.own')}
        </Button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) run(file);
            e.target.value = '';
          }}
        />
      </div>

      {error && <p className="text-bad">{error}</p>}

      {result && (
        <div className="space-y-3">
          <p className={result.passed ? 'text-good' : 'text-bad'}>
            {result.verdict}. {t('verify.specimen', { name: result.specimen })}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {IMAGES.map((key) => (
              <figure key={key} className="space-y-1">
                <img src={result.images[key]} alt={t(`verify.${key}`)} className="w-full rounded border border-line" />
                <figcaption className="text-xs text-muted">{t(`verify.${key}`)}</figcaption>
              </figure>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">{t('verify.th_method')}</th>
                  <th className="py-1.5 pr-3 text-right font-medium" title={t('verify.th_error_title')}>
                    {t('verify.th_error')}
                  </th>
                  <th className="py-1.5 pr-3 text-right font-medium" title={t('verify.th_max_title')}>{t('verify.th_max')}</th>
                  <th className="py-1.5 pr-3 text-right font-medium" title={t('verify.th_psnr_title')}>
                    PSNR
                  </th>
                  <th className="py-1.5 text-right font-medium" title={t('verify.th_bg_title')}>{t('verify.th_bg')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {result.rows.map((row) => (
                  <tr key={row.id || row.method}>
                    <td className="py-1.5 pr-3">{row.method}</td>
                    <td className="py-1.5 pr-3 text-right">{row.mean_error}%</td>
                    <td className="py-1.5 pr-3 text-right text-muted">{row.max_error}%</td>
                    <td className="py-1.5 pr-3 text-right text-muted">{t('verify.db', { v: row.psnr })}</td>
                    <td className="py-1.5 text-right text-muted">{row.nonuniformity}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">{t('verify.note')}</p>
        </div>
      )}
    </div>
  );
}
