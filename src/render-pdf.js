// Renders display-list pages (see sheet.js) to a jsPDF document.
// The page size is exactly the layout's paper size; nothing is scaled.

function orientation(w, h) {
  return w > h ? 'landscape' : 'portrait';
}

// JsPDF: the jsPDF constructor. images: Map of key → PNG data URL.
export function renderPdf(JsPDF, pages, images = new Map()) {
  const first = pages[0];
  const doc = new JsPDF({ unit: 'pt', format: [first.width, first.height], orientation: orientation(first.width, first.height), compress: true });
  pages.forEach((page, i) => {
    if (i > 0) doc.addPage([page.width, page.height], orientation(page.width, page.height));
    drawOps(doc, page.ops, images);
  });
  return doc;
}

export function drawOps(doc, ops, images) {
  for (const op of ops) {
    switch (op.type) {
      case 'rect': {
        let style = null;
        if (op.fill != null) doc.setFillColor(op.fill);
        if (op.stroke != null) {
          doc.setDrawColor(op.stroke);
          doc.setLineWidth(op.lineWidth ?? 0.5);
        }
        if (op.fill != null && op.stroke != null) style = 'FD';
        else if (op.fill != null) style = 'F';
        else style = 'S';
        doc.rect(op.x, op.y, op.w, op.h, style);
        break;
      }
      case 'line':
        doc.setDrawColor(op.stroke);
        doc.setLineWidth(op.lineWidth ?? 0.5);
        doc.line(op.x1, op.y1, op.x2, op.y2);
        break;
      case 'poly': {
        const [x0, y0] = op.points[0];
        const deltas = [];
        for (let i = 1; i < op.points.length; i++) {
          deltas.push([op.points[i][0] - op.points[i - 1][0], op.points[i][1] - op.points[i - 1][1]]);
        }
        doc.setFillColor(op.fill);
        doc.lines(deltas, x0, y0, [1, 1], 'F', true);
        break;
      }
      case 'text':
        doc.setFont(op.font, op.style);
        doc.setFontSize(op.size);
        doc.setTextColor(op.color);
        for (const line of op.lines) doc.text(line.text, line.x, line.y, { align: op.align, baseline: 'alphabetic' });
        break;
      case 'image': {
        const src = images.get(op.key);
        if (src) doc.addImage(src, 'PNG', op.x, op.y, op.w, op.h, op.key, 'FAST');
        break;
      }
      default:
        throw new Error(`Unknown op type: ${op.type}`);
    }
  }
}
