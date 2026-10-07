"""Read-only PDF audit: unsorted text order plus actual glyph bounding boxes."""
import json
import sys
import pdfplumber
from pypdf import PdfReader

reader = PdfReader(sys.argv[1])
with pdfplumber.open(sys.argv[1]) as doc:
    page = doc.pages[0]
    # Flow order, not coordinate sorting, exposes detached/merged text columns.
    words = page.extract_words(use_text_flow=True, keep_blank_chars=False)
    lines = [dict(x=w['x0'], y=w['top'], width=w['x1']-w['x0'],
                  height=w['bottom']-w['top'], text=w['text']) for w in words]
    print(json.dumps(dict(pages=len(reader.pages),
                         text='\n'.join(p.extract_text() or '' for p in reader.pages),
                         lines=lines, width=page.width, height=page.height)))
