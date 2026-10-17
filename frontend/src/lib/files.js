import { translate } from '../i18n';

export const ACCEPT = '.tif,.tiff,.png,.jpg,.jpeg,.bmp';

export function isImageFile(file) {
  return /\.(tiff?|png|jpe?g|bmp)$/i.test(file.name);
}

/** Браузер не показывает TIFF — для них превью только после обработки в PNG/JPEG. */
export function browserCanShow(nameOrType) {
  return /(png|jpe?g|bmp)$/i.test(nameOrType);
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return translate('files.b', { n: bytes });
  if (bytes < 1024 ** 2) return translate('files.kb', { n: (bytes / 1024).toFixed(0) });
  return translate('files.mb', { n: (bytes / 1024 ** 2).toFixed(1) });
}

export function frameMeta(frame) {
  if (!frame) return '';
  const depth = frame.dtype === 'float32' ? translate('files.float') : translate('files.bits', { n: frame.bit_depth });
  return `${frame.width}×${frame.height}, ${depth}${frame.channels === 1 ? translate('files.mono') : ''}`;
}
