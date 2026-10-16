import { useRef, useState } from 'react';
import { verifyMethod } from '../api/client';
import { ACCEPT } from '../lib/files';
import { Button } from './ui';

const IMAGES = [
  ['truth', 'Эталон'],
  ['raw', 'Снято через «плохую» оптику'],
  ['corrected', 'Исправлено'],
];

/**
 * Проверка метода на эталоне: известный чистый снимок «снимается» с виньетированием,
 * пылью и оттенком, исправляется и сравнивается с оригиналом — в числах.
 */
export default function VerifyPanel() {
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
      <p className="text-muted">
        Берём чистый снимок, «снимаем» его через оптику с виньетированием, пылью и тёплым светом, исправляем и
        сравниваем с оригиналом. Так видно, насколько точно метод восстанавливает снимок, — в цифрах.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => run(null)} busy={busy}>
          Проверить метод
        </Button>
        <Button size="sm" onClick={() => input.current?.click()} disabled={busy}
          title="Чистый равномерно освещённый снимок на светлом фоне">
          Проверить на своём снимке
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
            {result.verdict}. Снимок: {result.specimen}.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {IMAGES.map(([key, label]) => (
              <figure key={key} className="space-y-1">
                <img src={result.images[key]} alt={label} className="w-full rounded border border-line" />
                <figcaption className="text-xs text-muted">{label}</figcaption>
              </figure>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Способ</th>
                  <th className="py-1.5 pr-3 text-right font-medium" title="Средняя разница с эталоном, % диапазона">
                    Ошибка
                  </th>
                  <th className="py-1.5 pr-3 text-right font-medium" title="Худшие 0,1% пикселей">Макс.</th>
                  <th className="py-1.5 pr-3 text-right font-medium" title="Пиковое отношение сигнал/шум: больше — лучше">
                    PSNR
                  </th>
                  <th className="py-1.5 text-right font-medium" title="Неравномерность фона">Фон</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {result.rows.map((row) => (
                  <tr key={row.method}>
                    <td className="py-1.5 pr-3">{row.method}</td>
                    <td className="py-1.5 pr-3 text-right">{row.mean_error}%</td>
                    <td className="py-1.5 pr-3 text-right text-muted">{row.max_error}%</td>
                    <td className="py-1.5 pr-3 text-right text-muted">{row.psnr} дБ</td>
                    <td className="py-1.5 text-right text-muted">{row.nonuniformity}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            Оставшаяся ошибка со светлым полем — в основном шум самой съёмки: при делении на светлое поле он слегка
            усиливается в тёмных углах. Без светлого поля пыль на оптике не убирается — это видно по большой
            максимальной ошибке.
          </p>
        </div>
      )}
    </div>
  );
}
