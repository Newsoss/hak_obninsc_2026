import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setApiLanguage } from './api/client';

/** Переводы интерфейса: ключ → [русский, английский]. Параметры в тексте — {name}. */
const DICT = {
  // шапка
  'tab.single': ['Обработка', 'Processing'],
  'tab.batch': ['Пакет', 'Batch'],
  'tab.method': ['О методе', 'Method'],
  'theme.light': ['Светлая тема', 'Light theme'],
  'theme.dark': ['Тёмная тема', 'Dark theme'],
  'lang.switch': ['Switch to English', 'Переключить на русский'],

  // вкладка «Обработка»
  'section.files': ['Файлы', 'Files'],
  'slot.raw': ['Снимок', 'Image'],
  'slot.bright': ['Светлое поле', 'Bright field'],
  'slot.dark': ['Темновой кадр', 'Dark frame'],
  'slot.bright_empty': ['Можно несколько кадров.', 'You can add several frames.'],
  'view.split': ['Шторка', 'Slider'],
  'view.side': ['Рядом', 'Side by side'],
  'view.map': ['Освещённость', 'Illumination'],
  'zoom.out': ['Отдалить', 'Zoom out'],
  'zoom.in': ['Приблизить', 'Zoom in'],
  'zoom.scale': [
    'Масштаб относительно реального размера снимка. Нажмите, чтобы вписать в окно',
    'Scale relative to the real image size. Click to fit the window',
  ],
  'zoom.one': ['Один пиксель снимка — один пиксель экрана', 'One image pixel per screen pixel'],
  'process.dirty': ['Настройки изменены', 'Settings changed'],
  'process.button': ['Обработать', 'Process'],
  'process.title': ['Пересчитать снимок с текущими настройками (Ctrl+Enter)', 'Recompute the image with current settings (Ctrl+Enter)'],
  'format.title': ['Формат файла', 'File format'],
  'format.source': ['Как у исходника', 'Same as source'],
  'save.button': ['Сохранить результат', 'Save result'],
  'save.dirty': [
    'Сохранится то, что сейчас на экране, без последних правок',
    'What is on screen now will be saved, without the latest changes',
  ],
  'approx.series': ['Светлое поле оценено по серии', 'Bright field estimated from the series'],
  'approx.none': ['Приблизительно: без светлого поля', 'Approximate: no bright field'],
  'hint.no_raw': ['Загрузите снимок препарата.', 'Upload a specimen image.'],
  'hint.empty': [
    'Загрузите снимок и светлое поле слева. Без светлого поля коррекция будет приблизительной.',
    'Upload an image and a bright field on the left. Without a bright field the correction is approximate.',
  ],
  'status.pixel': ['x {x}, y {y} · {chan}до {before} → после {after}', 'x {x}, y {y} · {chan}before {before} → after {after}'],
  'status.pixel_size': [' · пиксель {size}', ' · pixel {size}'],
  'status.processed': [' · обработка {ms} мс', ' · processed in {ms} ms'],
  'logs.button': ['Логи', 'Logs'],
  'logs.shortcut': ['Логи (Ctrl+`)', 'Logs (Ctrl+`)'],

  // сообщения в логах
  'log.averaging': ['{slot}: усредняю кадров — {n}…', '{slot}: averaging {n} frames…'],
  'log.pixel_size': [', пиксель {size}', ', pixel {size}'],
  'log.frames': ['кадров: {n}', '{n} frames'],
  'log.processed': ['Обработка {name}: {ms} мс', 'Processed {name}: {ms} ms'],
  'log.preview_error': ['Превью: {error}', 'Preview: {error}'],
  'log.detail_error': ['Детальный просмотр: {error}', 'Detail view: {error}'],
  'log.saved': [
    'Сохранено: {src} → {out} и {json}, {ms} мс. Исходный файл не изменён.',
    'Saved: {src} → {out} and {json}, {ms} ms. The source file is unchanged.',
  ],
  'log.meta_kept': ['Метаданные исходного TIFF перенесены в результат', 'Source TIFF metadata was copied to the result'],
  'log.save_error': ['Сохранение: {error}', 'Saving: {error}'],
  'log.profile_saved': ['Профиль сохранён в {file}', 'Profile saved to {file}'],
  'log.profile_loaded': ['Профиль загружен из {file}', 'Profile loaded from {file}'],
  'log.profile_error': ['Не удалось прочитать профиль {file}: {error}', 'Could not read profile {file}: {error}'],

  // настройки
  'section.profile': ['Профиль', 'Profile'],
  'preset.custom': ['Свои настройки', 'Custom settings'],
  'preset.ffc': ['Только выравнивание', 'Flat-field only'],
  'preset.brightfield': ['Светлое поле', 'Brightfield'],
  'preset.histology': ['Гистология', 'Histology'],
  'preset.fluorescence': ['Флуоресценция', 'Fluorescence'],
  'profile.load': ['Загрузить', 'Load'],
  'profile.load_title': ['Загрузить настройки из файла профиля или журнала *_ffc.json', 'Load settings from a profile file or an *_ffc.json log'],
  'profile.save': ['Сохранить', 'Save'],
  'profile.save_title': ['Сохранить настройки в файл профиля', 'Save settings to a profile file'],
  'profile.no_settings': ['в файле нет настроек', 'the file has no settings'],
  'section.lighting': ['Коррекция освещения', 'Illumination correction'],
  'set.neutralize': ['Убрать оттенок осветителя', 'Remove illuminant tint'],
  'set.smoothing': ['Сглаживание светлого поля', 'Bright field smoothing'],
  'set.off': ['нет', 'off'],
  'section.color': ['Цвет', 'Color'],
  'set.reset': ['Сбросить', 'Reset'],
  'set.auto_levels': ['Автоуровни', 'Auto levels'],
  'set.auto_wb': ['Автобаланс белого', 'Auto white balance'],
  'set.exposure': ['Экспозиция', 'Exposure'],
  'set.brightness': ['Яркость', 'Brightness'],
  'set.contrast': ['Контраст', 'Contrast'],
  'set.gamma': ['Гамма', 'Gamma'],
  'set.saturation': ['Насыщенность', 'Saturation'],
  'set.temperature': ['Температура', 'Temperature'],
  'set.tint': ['Оттенок', 'Tint'],
  'slider.reset': ['Двойной клик — сбросить', 'Double-click to reset'],

  // слот файла
  'slot.empty': ['Перетащите файл или нажмите', 'Drop a file or click'],
  'slot.optional': ['Необязательно. Перетащите или нажмите', 'Optional. Drop a file or click'],
  'slot.approximate': ['{name} — приблизительно', '{name} — approximate'],
  'slot.noise': [', шум ниже в {n}×', ', noise {n}× lower'],
  'slot.per_px': ['/пикс', '/px'],
  'slot.multiple': ['Можно выбрать несколько кадров — они будут усреднены', 'You can pick several frames — they will be averaged'],
  'slot.remove': ['Убрать', 'Remove'],

  // окно сравнения
  'viewer.before': ['До', 'Before'],
  'viewer.after': ['После', 'After'],
  'viewer.before_alt': ['До коррекции', 'Before correction'],
  'viewer.after_alt': ['После коррекции', 'After correction'],
  'viewer.map_alt': ['Карта освещённости', 'Illumination map'],
  'viewer.map': ['Освещённость по светлому полю', 'Illumination from the bright field'],
  'viewer.darker': ['темнее', 'darker'],
  'viewer.brighter': ['ярче', 'brighter'],
  'viewer.nav': ['Навигатор: щёлкните, чтобы перейти', 'Navigator: click to jump'],
  'viewer.approx_title': [
    'Светлое поле не снималось, а оценено — коррекция приблизительная',
    'No bright field was taken, it was estimated — the correction is approximate',
  ],
  'viewer.busy': ['Обработка…', 'Processing…'],

  // пакет
  'batch.title': ['Пакетная обработка', 'Batch processing'],
  'batch.calibration': ['Калибровка', 'Calibration'],
  'batch.bright_empty': ['Нет — оценим по серии (от {min} снимков)', 'None — will be estimated from the series ({min}+ images)'],
  'batch.mode_shared': ['Общая', 'Shared'],
  'batch.mode_per_image': ['Для каждого снимка', 'Per image'],
  'batch.mode_shared_title': [
    'Одно светлое поле на всю серию: загруженное или оцененное по серии',
    'One bright field for the whole series: uploaded or estimated from the series',
  ],
  'batch.mode_per_image_title': [
    'Светлое поле строится отдельно по каждому снимку',
    'A bright field is built separately from each image',
  ],
  'batch.per_image_note': [
    'Светлое поле оценивается по каждому снимку отдельно. Калибровка не нужна, снимки могут быть с разных микроскопов, но коррекция приблизительная: пыль на оптике не убирается.',
    'The bright field is estimated from each image separately. No calibration is needed and images may come from different microscopes, but the correction is approximate: dust on the optics is not removed.',
  ],
  'batch.log_start_per_image': [
    'Пакет: обработка файлов — {n}, светлое поле оценивается по каждому снимку{dark}',
    'Batch: processing {n} file(s), bright field estimated from each image{dark}',
  ],
  'batch.summary_per_image': ['светлое поле: по каждому снимку', 'bright field: per image'],
  'journal.per_image': [
    'Светлое поле не снималось: оно оценено по каждому снимку отдельно размытием. Коррекция приблизительная.',
    'No bright field was taken: it was estimated from each image separately by blurring. The correction is approximate.',
  ],
  'batch.estimate': ['Оценить по серии', 'Estimate from series'],
  'batch.estimate_title': [
    'Светлое поле по серии: в каждой точке берётся фон, где нет препарата. Нужно, чтобы препарат на снимках лежал в разных местах',
    'Bright field from the series: the background (no specimen) is taken at each point. The specimen must be in different places on the images',
  ],
  'batch.settings': ['Настройки', 'Settings'],
  'batch.settings_from': ['Берутся со вкладки «Обработка»: {preset}{neutral}{smooth}.', 'Taken from the Processing tab: {preset}{neutral}{smooth}.'],
  'batch.neutral': [', без оттенка осветителя', ', illuminant tint removed'],
  'batch.smooth': [', сглаживание {px} px', ', smoothing {px} px'],
  'batch.format': ['Формат файлов', 'File format'],
  'batch.add_files': ['Добавить файлы', 'Add files'],
  'batch.add_folder': ['Добавить папку', 'Add folder'],
  'batch.add_folder_title': ['Все снимки из папки, включая вложенные', 'All images from a folder, including subfolders'],
  'batch.stop': ['Остановить', 'Stop'],
  'batch.process': ['Обработать', 'Process'],
  'batch.reprocess': ['Обработать заново', 'Process again'],
  'batch.need_bright': ['Загрузите светлое поле или добавьте минимум {min} снимков', 'Upload a bright field or add at least {min} images'],
  'batch.will_estimate': ['Светлое поле будет оценено по серии', 'The bright field will be estimated from the series'],
  'batch.drop': ['Перетащите сюда снимки серии или целую папку (TIFF, PNG, JPEG).', 'Drop the series images or a whole folder here (TIFF, PNG, JPEG).'],
  'batch.drop_note': ['Ко всем применяются одна калибровка и одни настройки.', 'One calibration and one set of settings is applied to all of them.'],
  'batch.th_file': ['Файл', 'File'],
  'batch.th_size': ['Размер', 'Size'],
  'batch.th_time': ['Время', 'Time'],
  'batch.th_status': ['Статус', 'Status'],
  'batch.ms': ['{ms} мс', '{ms} ms'],
  'batch.open': ['Открыть', 'Open'],
  'batch.download': ['Скачать', 'Download'],
  'batch.remove': ['Убрать из списка', 'Remove from list'],
  'batch.progress': ['Готово {done} из {total}', 'Done {done} of {total}'],
  'batch.failed': [', с ошибкой {n}', ', failed {n}'],
  'batch.seconds': [' · {s} с', ' · {s} s'],
  'batch.summary': ['Сводка до/после', 'Before/after summary'],
  'batch.summary_title': ['Все снимки серии «до / после» на одной картинке', 'All images of the series “before / after” in one picture'],
  'batch.download_each': ['Скачать по одному', 'Download one by one'],
  'batch.zip': ['Скачать ZIP', 'Download ZIP'],
  'batch.zip_title': ['Результаты, их журналы, processing.json и сводка до/после', 'Results, their logs, processing.json and the before/after summary'],
  'status.done': ['Готово', 'Done'],
  'status.processing': ['Обработка', 'Processing'],
  'status.error': ['Ошибка', 'Error'],
  'status.queued': ['Ожидает', 'Queued'],
  'batch.log_skipped': ['Пропущено файлов не в формате TIFF/PNG/JPEG/BMP: {n}', 'Skipped files not in TIFF/PNG/JPEG/BMP: {n}'],
  'batch.log_added': ['Добавлено в пакет ({source}): {n}', 'Added to the batch ({source}): {n}'],
  'batch.src_files': ['файлы', 'files'],
  'batch.src_drop': ['перетаскивание', 'drag and drop'],
  'batch.src_folder': ['папка', 'folder'],
  'batch.log_need_series': [
    'Чтобы оценить светлое поле по серии, нужно минимум {min} снимков (сейчас {n})',
    'Estimating the bright field from the series needs at least {min} images (now {n})',
  ],
  'batch.log_estimating': ['Оцениваю светлое поле по серии из {n} снимков…', 'Estimating the bright field from {n} images…'],
  'batch.log_estimate_error': ['Оценка светлого поля: {error}', 'Bright field estimate: {error}'],
  'batch.log_start': ['Пакет: обработка файлов — {n}, светлое поле {bright}{dark}', 'Batch: processing {n} file(s), bright field {bright}{dark}'],
  'batch.log_start_dark': [', темновой кадр {name}', ', dark frame {name}'],
  'batch.log_file': ['{path} → {out}, {ms} мс', '{path} → {out}, {ms} ms'],
  'batch.log_done': ['Пакет готов за {s} с', 'Batch finished in {s} s'],
  'batch.log_stopped': ['Пакет остановлен через {s} с', 'Batch stopped after {s} s'],
  'batch.log_saved': ['Сохранено: {out} и {json}', 'Saved: {out} and {json}'],
  'batch.summary_heading': ['MicroCleaner — серия из {n} снимков', 'MicroCleaner — series of {n} images'],
  'batch.summary_bright': ['светлое поле {name}', 'bright field {name}'],
  'batch.summary_dark': ['темновой кадр {name}', 'dark frame {name}'],
  'batch.log_summary': ['Сводка до/после сохранена: {file}', 'Before/after summary saved: {file}'],
  'batch.log_summary_error': ['Сводка: {error}', 'Summary: {error}'],
  'batch.log_zip': [
    'Сохранён {file}: файлов {n}, журналы *_ffc.json, processing.json и summary.png',
    'Saved {file}: {n} file(s), *_ffc.json logs, processing.json and summary.png',
  ],

  // логи
  'logs.title': ['Логи', 'Logs'],
  'logs.clear': ['Очистить', 'Clear'],
  'logs.close': ['Закрыть (Ctrl+`)', 'Close (Ctrl+`)'],
  'logs.empty': ['Здесь будут сообщения о загрузке, обработке и сохранении файлов.', 'Messages about loading, processing and saving files will appear here.'],

  // о методе
  'method.title': ['Как работает коррекция', 'How the correction works'],
  'method.intro': [
    'При съёмке под микроскопом на снимках появляются виньетирование, неравномерная подсветка, пятна от пыли на оптике и цветовой оттенок лампы. Это ошибки самого прибора, и на всех кадрах они одинаковые. Поэтому их можно один раз измерить по калибровочным снимкам и потом вычитать из каждого кадра.',
    'Microscope images suffer from vignetting, uneven illumination, dust spots on the optics and the color cast of the lamp. These are errors of the instrument itself, and they are the same on every frame. So they can be measured once from calibration images and then removed from every frame.',
  ],
  'method.formula': ['Формула', 'Formula'],
  'method.r': ['исходный снимок препарата;', 'the original specimen image;'],
  'method.f': ['светлое поле: то же поле зрения без препарата;', 'bright field: the same field of view without the specimen;'],
  'method.d': ['темновой кадр с закрытым затвором (если его нет, D = 0);', 'dark frame with the shutter closed (if there is none, D = 0);'],
  'method.m': ['средняя яркость (F − D), чтобы общая яркость снимка не менялась.', 'mean brightness of (F − D), so the overall brightness does not change.'],
  'method.verify': ['Проверка на эталоне', 'Reference check'],
  'method.limits': ['Ограничения', 'Limitations'],
  'method.limits_text': [
    'Это исследовательская обработка изображений, а не инструмент для диагностики. Программа использует только арифметику над пикселями и общие тоновые настройки, никаких нейросетей, поэтому новых деталей на снимке появиться не может. Для диагностики и публикации храните исходники и прикладывайте журнал обработки.',
    'This is research image processing, not a diagnostic tool. The program uses only pixel arithmetic and global tone adjustments, no neural networks, so no new details can appear in the image. For diagnostics and publications keep the originals and attach the processing log.',
  ],

  // проверка на эталоне
  'verify.intro': [
    'Берём чистый снимок, «снимаем» его через оптику с виньетированием, пылью и тёплым светом, исправляем и сравниваем с оригиналом. Так видно, насколько точно метод восстанавливает снимок, — в цифрах.',
    'We take a clean image, “shoot” it through optics with vignetting, dust and warm light, correct it and compare with the original. This shows in numbers how accurately the method restores the image.',
  ],
  'verify.run': ['Проверить метод', 'Check the method'],
  'verify.own': ['Проверить на своём снимке', 'Check on my own image'],
  'verify.own_title': ['Чистый равномерно освещённый снимок на светлом фоне', 'A clean, evenly lit image on a light background'],
  'verify.specimen': ['Снимок: {name}.', 'Image: {name}.'],
  'verify.truth': ['Эталон', 'Reference'],
  'verify.raw': ['Снято через «плохую» оптику', 'Shot through “bad” optics'],
  'verify.corrected': ['Исправлено', 'Corrected'],
  'verify.th_method': ['Способ', 'Method'],
  'verify.th_error': ['Ошибка', 'Error'],
  'verify.th_error_title': ['Средняя разница с эталоном, % диапазона', 'Mean difference from the reference, % of range'],
  'verify.th_max': ['Макс.', 'Max'],
  'verify.th_max_title': ['Худшие 0,1% пикселей', 'Worst 0.1% of pixels'],
  'verify.th_psnr_title': ['Пиковое отношение сигнал/шум: больше — лучше', 'Peak signal-to-noise ratio: higher is better'],
  'verify.th_bg': ['Фон', 'Background'],
  'verify.th_bg_title': ['Неравномерность фона', 'Background unevenness'],
  'verify.db': ['{v} дБ', '{v} dB'],
  'verify.note': [
    'Оставшаяся ошибка со светлым полем — в основном шум самой съёмки: при делении на светлое поле он слегка усиливается в тёмных углах. Без светлого поля пыль на оптике не убирается — это видно по большой максимальной ошибке.',
    'The remaining error with a bright field is mostly the noise of the shot itself: dividing by the bright field slightly amplifies it in dark corners. Without a bright field the dust on the optics is not removed — which shows up as a large maximum error.',
  ],

  // разное
  'files.b': ['{n} Б', '{n} B'],
  'files.kb': ['{n} КБ', '{n} KB'],
  'files.mb': ['{n} МБ', '{n} MB'],
  'files.bits': ['{n} бит', '{n}-bit'],
  'files.float': ['32 бит float', '32-bit float'],
  'files.mono': [', ч/б', ', mono'],
  'api.offline': ['Сервер недоступен — запущен ли backend на :8000?', 'Server unavailable — is the backend running on :8000?'],
  'image.load_error': ['не удалось загрузить изображение', 'could not load the image'],
  'journal.note': [
    'Исследовательская обработка. Исходный файл не изменялся и должен храниться отдельно.',
    'Research image processing. The source file was not modified and must be kept separately.',
  ],
};

const LANGS = ['ru', 'en'];
let current = 'ru';

function initialLanguage() {
  try {
    const saved = localStorage.getItem('lang');
    if (LANGS.includes(saved)) return saved;
  } catch {
    /* приватный режим */
  }
  return (navigator.language || 'ru').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

/** Перевод вне React-компонентов (подписи файлов, журналы, ошибки клиента API). */
export function translate(key, params) {
  const entry = DICT[key];
  if (!entry) return key;
  let text = entry[LANGS.indexOf(current)] ?? entry[0];
  if (params) for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value));
  return text;
}

export const currentLanguage = () => current;

const I18nContext = createContext({ lang: 'ru', setLang: () => {}, t: translate });

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    current = initialLanguage();
    setApiLanguage(current);
    return current;
  });

  const setLang = useCallback((next) => {
    current = next;
    setApiLanguage(next);
    setLangState(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem('lang', lang);
    } catch {
      /* приватный режим */
    }
  }, [lang]);

  // t пересоздается при смене языка — компоненты перерисовываются с новым текстом
  const value = useMemo(() => ({ lang, setLang, t: (key, params) => translate(key, params) }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
