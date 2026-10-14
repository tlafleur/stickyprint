// Renders display-list pages (see sheet.js) to a 2D canvas for the preview.

import { FONTS } from './textfit.js';

function gray(g) {
  return `rgb(${g},${g},${g})`;
}

// view: { scale, originX, originY } maps page points to canvas pixels.
// images: Map of key → canvas or image element.
export function renderCanvas(ctx, page, images, view) {
  const { scale, originX = 0, originY = 0 } = view;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, -originX * scale, -originY * scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, page.width, page.height);
  for (const op of page.ops) {
    switch (op.type) {
      case 'rect':
        if (op.fill != null) {
          ctx.fillStyle = gray(op.fill);
          ctx.fillRect(op.x, op.y, op.w, op.h);
        }
        if (op.stroke != null) {
          ctx.strokeStyle = gray(op.stroke);
          // Keep hairlines visible at small preview scales.
          ctx.lineWidth = Math.max(op.lineWidth ?? 0.5, 1 / scale);
          ctx.strokeRect(op.x, op.y, op.w, op.h);
        }
        break;
      case 'line':
        ctx.strokeStyle = gray(op.stroke);
        ctx.lineWidth = Math.max(op.lineWidth ?? 0.5, 1 / scale);
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.stroke();
        break;
      case 'poly':
        ctx.fillStyle = gray(op.fill);
        ctx.beginPath();
        op.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
        break;
      case 'text': {
        const f = FONTS[op.font] || FONTS.helvetica;
        const italic = op.style.includes('italic') ? 'italic ' : '';
        const bold = op.style.includes('bold') ? 'bold ' : '';
        ctx.font = `${italic}${bold}${op.size}px ${f.css}`;
        ctx.fillStyle = gray(op.color);
        ctx.textAlign = op.align;
        ctx.textBaseline = 'alphabetic';
        for (const line of op.lines) ctx.fillText(line.text, line.x, line.y);
        break;
      }
      case 'image': {
        const src = images.get(op.key);
        if (src) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(src, op.x, op.y, op.w, op.h);
        }
        break;
      }
      default:
        break;
    }
  }
  ctx.restore();
}
