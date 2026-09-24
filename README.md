# 春夏秋冬野貓觀察日記 線上試閱

右翻（右側裝訂）的漫畫試閱網頁，放在 GitHub Pages。

## 資料夾

```
預覽合本/
├─ convert.py        把 PDF 轉成網頁圖片的腳本
├─ *.pdf             原始 PDF（不會上傳，太大了）
└─ docs/             ← 網站本體（GitHub Pages 會發布這個資料夾）
   ├─ config.js      標題、作者、封面設定
   ├─ index.html / style.css / reader.js
   └─ pages/         轉好的頁面圖片 + pages.json
```

## 換新版 PDF

1. 把新的 PDF 放進這個資料夾
2. 在這個資料夾開終端機，執行：

   ```
   python convert.py 新檔名.pdf
   ```

   （第一次使用要先安裝：`pip install pymupdf pillow`）
3. 會自動清掉舊圖、產生新的 `docs/pages/`，頁數變了也沒關係
4. 上傳到 GitHub（commit + push）

原始 PDF 約 270MB，超過 GitHub 單檔 100MB 的上限；轉成高 2400px 的 WebP 後整本約 5MB，手機也能很快打開。
想要放大時更清楚，可以調高 `convert.py` 裡的 `PAGE_HEIGHT`（檔案會跟著變大）。

## 放上 GitHub Pages

1. 在 GitHub 建立新的 repository（Public）
2. 上傳整個資料夾（`.gitignore` 已經設定不上傳 PDF）
   repository：https://github.com/Russell0123/athology_viewer
3. **Settings → Pages → Source** 選 `Deploy from a branch`，Branch 選 `main`，資料夾選 **`/docs`**，按 Save
4. 網址：https://russell0123.github.io/athology_viewer/

## 操作

| 動作 | 效果 |
|---|---|
| 點左半邊／← 鍵／往右滑（手指、滑鼠拖曳、觸控板） | 下一頁 |
| 點右半邊／→ 鍵／往左滑 | 上一頁 |
| 工具列「闔上／打開」 | 闔上回封面，或打開回到剛剛讀的地方 |
| 工具列「單頁／跨頁」 | 切換顯示方式 |
| 工具列「平面／傾斜」 | 切換視角 |
| 工具列 − ／ ＋、滑鼠滾輪、兩指捏合、+ − 鍵 | 縮放（放大後可拖曳移動；點百分比或按 0 鍵回到原大小） |
| F 鍵 | 全螢幕 |
| 網址加 `#p=12` | 直接打開到第 12 頁 |
