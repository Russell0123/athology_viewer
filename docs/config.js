// 這個檔案是唯一需要修改的設定
window.BOOK = {
  title: '春夏秋冬野貓觀察日記',
  author: '要樂奈&MyGO全員一般向插畫合本',

  // PDF 第 1 頁是封面嗎？
  //   true  → 闔上時顯示第 1 頁當封面
  //   false → 自動產生一張標題封面，打開後第 1 頁在第一個跨頁的左側
  startsWithCover: true,

  // PDF 最後一頁是封底嗎？（總頁數是奇數時，會自動在封底前補一張白頁）
  endsWithBackCover: true,

  // 一打開是否用傾斜視角（讀者可以用工具列切換）
  tilt: true,

  // 翻頁動畫時間（毫秒）
  flipMs: 700,
};
