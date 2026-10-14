# Sticky Note Printer

A static web app for printing on sticky notes with a black-and-white laser
printer. Stick notes onto a sheet of Letter or A4 paper, feed it through the
printer, and the content lands on the notes.

It runs entirely in the browser. Nothing is uploaded.

## How it works

1. Enter the paper size, note size, gap and margins. The app fits as many notes
   as it can inside the printable area, centered on the page.
2. **Pass 1, alignment sheet:** print it on blank paper. It shows an outline
   for each note, a shaded band where the adhesive strip goes, which edge to
   feed first, which side gets printed, and a reference square for checking
   the print scale.
3. Stick notes inside the outlines, adhesive strip on the shaded band (the
   leading edge, so the rollers don't peel the notes back).
4. Reload the sheet the same way and print **pass 2, the content sheet**. It
   contains only the note contents, at the same coordinates as pass 1.

Always print at **Actual size / 100%**, not "Fit to page".

## Development

No build step. Serve the folder with any static server:

```sh
npm install        # jsPDF (pinned) for tests and sample generation
npm run serve      # http://localhost:8080
npm test           # unit tests (node:test)
npm run check      # generate sample PDFs and check them with pdftoppm
```

`npm run check` needs poppler-utils, Python 3, Pillow and NumPy. The sample
PDFs land in `samples/` (git-ignored).

The browser loads jsPDF from `vendor/jspdf-4.2.1.umd.min.js`. To upgrade, change
the version in `package.json`, run `npm install && npm run vendor`, and update
the `<script>` tag in `index.html`.

## Code layout

| File | Purpose |
| --- | --- |
| `src/layout.js` | Pure layout math: settings → page size and note rectangles in points. |
| `src/sheet.js` | Builds the alignment and content sheets as display lists of drawing operations. |
| `src/render-pdf.js` | Draws a display list into a jsPDF document. |
| `src/render-canvas.js` | Draws the same display list onto a canvas for the preview. |
| `src/textfit.js` | Text wrapping and auto-fit, measured with jsPDF. |
| `src/imageproc.js` | Grayscale, threshold and Floyd–Steinberg dithering at 300 DPI. |
| `src/settings.js` | Defaults, unit switching, localStorage persistence. |
| `src/app.js` | UI wiring. |

Hooks for later features:

- **Different content per note / mail merge:** `buildContentPage` takes a
  `contentFor(note)` function, and `renderPdf` takes an array of pages. A CSV
  merge would build one content page per chunk of rows.
- **Printer offset calibration:** settings already carry `offsetX`/`offsetY`
  (default 0), which `computeLayout` applies to every note on both sheets.
- **Saved presets:** settings are one plain JSON object (`src/settings.js`).
- **Text and image on one note:** content ops are independent; a combined
  content type can emit both an image op and a text op for the same box.

## Deployment

`.github/workflows/pages.yml` runs the tests and publishes the site to GitHub
Pages on every push to `main`. In the repository settings, set
**Settings → Pages → Build and deployment → Source** to **GitHub Actions**.
