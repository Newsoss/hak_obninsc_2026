// Сводка серии «до / после» для отчёта: рисуется в браузере на canvas.

import { translate } from '../i18n';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(translate('image.load_error')));
    img.src = src;
  });
}

const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

function label(ctx, text, x, y) {
  ctx.font = `600 15px ${FONT}`;
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x, y, w, 24);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x + 7, y + 17);
}

/** Сводка серии: строка на каждый снимок — имя, «до» и «после». */
export async function contactSheet(rows, title, subtitle) {
  const cell = 360;
  const gap = 10;
  const pad = 20;
  const nameH = 26;
  const headerH = 64;
  const images = await Promise.all(rows.map((r) => Promise.all([loadImage(r.before), loadImage(r.after)])));
  const heights = images.map(([b]) => Math.round((b.height / b.width) * cell));

  const canvas = document.createElement('canvas');
  canvas.width = pad * 2 + cell * 2 + gap;
  canvas.height = pad + headerH + heights.reduce((s, h) => s + nameH + h + gap * 2, 0) + pad;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#18181b';
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(title, pad, pad + 22);
  ctx.fillStyle = '#52525b';
  ctx.font = `13px ${FONT}`;
  ctx.fillText(subtitle, pad, pad + 46);

  let y = pad + headerH;
  rows.forEach((row, i) => {
    const [before, after] = images[i];
    const h = heights[i];
    ctx.fillStyle = '#18181b';
    ctx.font = `14px ${FONT}`;
    ctx.fillText(row.name, pad, y + 18);
    ctx.fillStyle = '#71717a';
    ctx.textAlign = 'right';
    ctx.fillText(row.note, canvas.width - pad, y + 18);
    ctx.textAlign = 'left';
    y += nameH;
    ctx.drawImage(before, pad, y, cell, h);
    ctx.drawImage(after, pad + cell + gap, y, cell, h);
    if (i === 0) {
      label(ctx, translate('viewer.before'), pad + 8, y + 8);
      label(ctx, translate('viewer.after'), pad + cell + gap + 8, y + 8);
    }
    y += h + gap * 2;
  });
  return toBlob(canvas);
}
