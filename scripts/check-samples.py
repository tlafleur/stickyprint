"""Renders samples/*.pdf with pdftoppm and checks that the alignment outlines
and the content land at the same coordinates.

Usage: npm run samples && python3 scripts/check-samples.py
Requires poppler-utils (pdftoppm, pdfinfo), Pillow and NumPy.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

DPI = 150
S = DPI / 72  # pixels per point
SAMPLES = Path("samples")


def render(pdf, tmp):
    out = Path(tmp) / pdf.stem
    subprocess.run(["pdftoppm", "-r", str(DPI), "-gray", "-png", "-singlefile", str(pdf), str(out)], check=True)
    return np.asarray(Image.open(str(out) + ".png").convert("L"), dtype=np.int16)


def page_size(pdf):
    info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, check=True).stdout
    line = next(l for l in info.splitlines() if l.startswith("Page size:"))
    parts = line.split()
    return float(parts[2]), float(parts[4])


def outline_columns(img, note, y_frac=0.75):
    """Columns of the darkest pixels near the note's left and right edges, on a
    row inside the note (below the adhesive band)."""
    y = int(round((note["y"] + note["h"] * y_frac) * S))
    row = img[y]
    found = []
    for edge in (note["x"], note["x"] + note["w"]):
        c = int(round(edge * S))
        lo, hi = max(0, c - 4), min(len(row), c + 5)
        found.append(lo + int(np.argmin(row[lo:hi])))
    return found


def outline_rows(img, note):
    x = int(round((note["x"] + note["w"] * 0.5) * S))
    col = img[:, x]
    found = []
    for edge in (note["y"] + note["h"],):  # bottom edge (top edge is inside the shaded band)
        r = int(round(edge * S))
        lo, hi = max(0, r - 4), min(len(col), r + 5)
        found.append(lo + int(np.argmin(col[lo:hi])))
    return found


def main():
    layouts = json.loads((SAMPLES / "layouts.json").read_text())
    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        for L in layouts:
            name = L["name"]
            pdfs = {k: SAMPLES / f"{name}-{k}.pdf" for k in ("alignment", "content", "content-outline", "image")}
            for k, pdf in pdfs.items():
                w, h = page_size(pdf)
                if abs(w - L["pageW"]) > 0.01 or abs(h - L["pageH"]) > 0.01:
                    print(f"FAIL {name}-{k}: page {w}x{h}, expected {L['pageW']:.3f}x{L['pageH']:.3f}")
                    failures += 1
            align = render(pdfs["alignment"], tmp)
            outlined = render(pdfs["content-outline"], tmp)
            content = render(pdfs["content"], tmp)
            image = render(pdfs["image"], tmp)

            # 1. Outlines on the content sheet are at the same pixels as on the alignment sheet.
            max_dev = 0
            for n in L["notes"]:
                a = outline_columns(align, n) + outline_rows(align, n)
                b = outline_columns(outlined, n) + outline_rows(outlined, n)
                expected = [n["x"] * S, (n["x"] + n["w"]) * S, (n["y"] + n["h"]) * S]
                max_dev = max(max_dev, max(abs(p - q) for p, q in zip(a, b)))
                max_dev = max(max_dev, max(abs(p - e) for p, e in zip(a, expected)) - 0.5)
            ok = max_dev <= 1
            failures += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {name}: outline positions match the layout and each other (max deviation {max_dev}px at {DPI} dpi)")

            # 2. All ink on the content sheets is inside the notes' content boxes.
            for label, img in (("text", content), ("image", image)):
                mask = np.zeros(img.shape, dtype=bool)
                for n in L["notes"]:
                    c = n["content"]
                    if label == "image":
                        # The image sheet also has light outlines; allow the full note.
                        c = n
                    x0, y0 = int(np.floor(c["x"] * S)) - 1, int(np.floor(c["y"] * S)) - 1
                    x1, y1 = int(np.ceil((c["x"] + c["w"]) * S)) + 1, int(np.ceil((c["y"] + c["h"]) * S)) + 1
                    mask[y0:y1, x0:x1] = True
                ink = img < 200
                outside = int((ink & ~mask).sum())
                inside_notes = sum(int(ink[int(n["content"]["y"] * S):int((n["content"]["y"] + n["content"]["h"]) * S),
                                           int(n["content"]["x"] * S):int((n["content"]["x"] + n["content"]["w"]) * S)].sum() > 0)
                                   for n in L["notes"])
                ok = outside == 0 and inside_notes == L["count"]
                failures += not ok
                print(f"{'ok  ' if ok else 'FAIL'} {name}: {label} ink inside content boxes "
                      f"({inside_notes}/{L['count']} notes have ink, {outside} px outside)")
    print("\nAll checks passed." if failures == 0 else f"\n{failures} check(s) failed.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
