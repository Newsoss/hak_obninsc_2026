import { Aperture, Archive, Gauge, Layers, ShieldCheck, Sigma, Sparkles } from 'lucide-react';

const STEPS = [
  {
    icon: Aperture,
    title: 'Калибровка',
    text: 'Светлое поле F снимается без образца при тех же настройках оптики. Темновой кадр D — с закрытым затвором: он содержит пьедестал матрицы, полосы и горячие пиксели.',
  },
  {
    icon: Sigma,
    title: 'Профиль усиления',
    text: 'По калибровке один раз вычисляется карта gain = m / (F − D). Она хранит виньетирование, перекос света, пятна пыли и оттенок осветителя.',
  },
  {
    icon: Layers,
    title: 'Применение к серии',
    text: 'Каждый снимок: C = (R − D) · gain. Профиль переиспользуется, поэтому серия обрабатывается одинаково и быстро — без ручной подстройки.',
  },
  {
    icon: Sparkles,
    title: 'Цветокоррекция',
    text: 'После выравнивания — экспозиция, контраст, гамма, насыщенность, баланс белого. Работает в исходной битности: 16-битный TIFF остается 16-битным.',
  },
];

const API = [
  ['POST', '/api/frames', 'загрузить кадр, получить id и миниатюру'],
  ['POST', '/api/process/preview', 'превью «до/после», метрики, гистограммы'],
  ['POST', '/api/process/export', 'полноразмерный результат в исходном формате'],
  ['POST', '/api/process/file', 'снимок серии с загруженной калибровкой'],
  ['POST', '/api/process/batch', 'вся серия одним запросом → ZIP + report.csv'],
  ['GET', '/api/demo/{name}.png', 'синтетические кадры для демонстрации'],
];

export default function MethodView() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 lg:p-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Flat-field correction</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          При съемке микропрепаратов возникают виньетирование, неравномерная подсветка, статические пятна и цветовые
          искажения. Это систематические ошибки оптического тракта — они одинаковы на всех кадрах, поэтому их можно
          измерить по калибровочным снимкам и вычесть математически.
        </p>
      </div>

      <div className="panel overflow-hidden">
        <div className="bg-gradient-to-br from-cyan-500/10 to-indigo-500/10 p-6 text-center">
          <div className="font-mono text-xl font-semibold tracking-tight sm:text-2xl">
            C = <span className="text-rose-500">(R − D)</span> / <span className="text-amber-500">(F − D)</span> ×{' '}
            <span className="text-accent">m</span>
          </div>
        </div>
        <dl className="grid gap-px bg-line text-xs sm:grid-cols-2">
          {[
            ['R', 'исходный снимок с артефактами', 'text-rose-500'],
            ['F', 'светлое поле — кадр без образца', 'text-amber-500'],
            ['D', 'темновой кадр (необязателен, иначе D = 0)', 'text-muted'],
            ['m', 'средняя яркость (F − D): сохраняет экспозицию', 'text-accent'],
          ].map(([k, v, tone]) => (
            <div key={k} className="flex gap-3 bg-surface p-3">
              <dt className={`font-mono text-sm font-bold ${tone}`}>{k}</dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <div key={title} className="panel p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon className="h-4 w-4" />
              </span>
              <span className="font-mono text-[11px] text-faint">0{i + 1}</span>
              <h3 className="text-sm font-semibold">{title}</h3>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">{text}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="panel p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-good" /> Устойчивость
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted">
            <li>Знаменатель ограничен снизу 1% средней яркости поля — нет деления на ноль и «взрыва» битых пикселей.</li>
            <li>Вычисления во float32, результат отсекается по диапазону исходной битности.</li>
            <li>Калибровка другого размера или с другим числом каналов приводится к снимку автоматически.</li>
            <li>Нейтрализация оттенка: общая нормировка m для всех каналов делает фон серым.</li>
          </ul>
        </div>
        <div className="panel p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Gauge className="h-4 w-4 text-accent" /> Метрики
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted">
            <li>
              <b className="text-ink">Неравномерность</b> — коэффициент вариации сильно размытой яркости (тренд фона), %.
              Чем меньше, тем ровнее.
            </li>
            <li>
              <b className="text-ink">Углы / центр</b> — отношение яркости углов к центру. 100% означает отсутствие
              виньетирования.
            </li>
          </ul>
        </div>
      </div>

      <div className="panel space-y-3 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Archive className="h-4 w-4 text-accent" /> Почему исходные пиксели хранятся отдельно
        </h3>
        <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-muted">
          <li>
            <b className="text-ink">Коррекция необратима.</b> Отсечение диапазона, округление, автоуровни и гамма теряют
            информацию — восстановить исходные значения из результата нельзя.
          </li>
          <li>
            <b className="text-ink">Калибровка может оказаться ошибочной.</b> Сдвинулась лампа, на светлом поле была грязь,
            выбран не тот профиль — переобработать можно только из оригинала.
          </li>
          <li>
            <b className="text-ink">Измерения делаются по сырым данным.</b> Интенсивность, денситометрия, подсчет — цветокоррекция
            меняет значения пикселей и искажает количественный анализ.
          </li>
          <li>
            <b className="text-ink">Проверяемость.</b> Для публикации и экспертизы нужно предъявить исходник и всю цепочку
            преобразований.
          </li>
        </ol>
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          {[
            ['Не перезаписывает', 'результат всегда отдельный файл *_ffc, оригинал не трогается'],
            ['Документирует', 'processing.json и тег TIFF: формула, параметры, SHA-256 входов и результата'],
            ['Повторяемо', 'тот же вход и профиль дают побайтно тот же файл — проверено тестами'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-xl bg-raised p-3 ring-1 ring-line">
              <div className="font-semibold text-ink">{t}</div>
              <div className="mt-0.5 text-muted">{d}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-xs leading-relaxed text-ink">
        <b>Ответственное использование.</b> Это исследовательская обработка изображений, а не диагностический инструмент.
        Используются только попиксельная арифметика и глобальные тоновые преобразования — никаких генеративных моделей,
        поэтому новые структуры на снимке появиться не могут. Для диагностики и публикации храните исходники, проверяйте
        корректность и прикладывайте журнал преобразований.
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold">REST API</h3>
          <a href="/docs" target="_blank" rel="noreferrer" className="text-xs font-medium text-accent hover:underline">
            Swagger →
          </a>
        </div>
        <ul className="divide-y divide-line font-mono text-[11px]">
          {API.map(([method, path, desc]) => (
            <li key={path} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <span className={`w-10 font-semibold ${method === 'GET' ? 'text-good' : 'text-accent'}`}>{method}</span>
              <span className="text-ink">{path}</span>
              <span className="font-sans text-muted sm:ml-auto">{desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
