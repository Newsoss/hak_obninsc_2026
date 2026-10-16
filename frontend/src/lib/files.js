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
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
}

export function frameMeta(frame) {
  if (!frame) return '';
  const depth = frame.dtype === 'float32' ? '32 бит float' : `${frame.bit_depth} бит`;
  const channels = frame.channels === 1 ? 'Ч/Б' : 'RGB';
  return `${frame.width}×${frame.height} · ${depth} · ${channels}`;
}
