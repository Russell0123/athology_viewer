"""把 PDF 轉成網頁用的圖片。

用法：
    python convert.py 合本.pdf

會清空 docs/pages/，重新產生每一頁的 WebP 圖片和 pages.json。
需要先安裝一次：pip install pymupdf pillow
"""
import json
import sys
import time
from pathlib import Path

import pymupdf
from PIL import Image

PAGE_HEIGHT = 2400   # 每頁圖片高度（像素）；越高放大越清楚，檔案也越大
QUALITY = 85         # WebP 畫質（0–100）

OUT = Path(__file__).parent / 'docs' / 'pages'


def main():
    if len(sys.argv) != 2:
        sys.exit('用法：python convert.py 你的檔案.pdf')
    pdf_path = Path(sys.argv[1])
    doc = pymupdf.open(pdf_path)

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*'):
        old.unlink()

    files, total = [], 0
    for i, page in enumerate(doc, start=1):
        zoom = PAGE_HEIGHT / page.rect.height
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        name = f'{i:03d}.webp'
        img.save(OUT / name, 'WEBP', quality=QUALITY, method=6)
        files.append(name)
        total += (OUT / name).stat().st_size
        print(f'\r轉檔中 {i}/{doc.page_count}', end='', flush=True)

    manifest = {
        'width': img.width,
        'height': img.height,
        'pages': files,
        'version': int(time.time()),  # 讓瀏覽器知道圖片更新了
    }
    (OUT / 'pages.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'\n完成：{len(files)} 頁，共 {total / 1e6:.1f} MB → {OUT}')


if __name__ == '__main__':
    main()
