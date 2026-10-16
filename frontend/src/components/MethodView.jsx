import VerifyPanel from './VerifyPanel';

function H({ children }) {
  return <h3 className="mb-2 mt-8 text-base font-semibold">{children}</h3>;
}

export default function MethodView() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-8 leading-relaxed text-ink">
      <h2 className="text-xl font-semibold">Как работает коррекция</h2>
      <p className="mt-3 text-muted">
        При съёмке под микроскопом на снимках появляются виньетирование, неравномерная подсветка, пятна от пыли на оптике и
        цветовой оттенок лампы. Это ошибки самого прибора, и на всех кадрах они одинаковые. Поэтому их можно один раз
        измерить по калибровочным снимкам и потом вычитать из каждого кадра.
      </p>

      <H>Формула</H>
      <pre className="overflow-x-auto rounded-md border border-line bg-surface px-4 py-3 font-mono text-sm">
        C = (R − D) / (F − D) × m
      </pre>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
        <li><b className="text-ink">R</b> — исходный снимок препарата;</li>
        <li><b className="text-ink">F</b> — светлое поле: то же поле зрения без препарата;</li>
        <li><b className="text-ink">D</b> — темновой кадр с закрытым затвором (если его нет, D = 0);</li>
        <li><b className="text-ink">m</b> — средняя яркость (F − D), чтобы общая яркость снимка не менялась.</li>
      </ul>

      <H>Проверка на эталоне</H>
      <VerifyPanel />

      <H>Ограничения</H>
      <p className="text-muted">
        Это исследовательская обработка изображений, а не инструмент для диагностики. Программа использует только
        арифметику над пикселями и общие тоновые настройки, никаких нейросетей, поэтому новых деталей на снимке появиться
        не может. Для диагностики и публикации храните исходники и прикладывайте журнал обработки.
      </p>

    </article>
  );
}
