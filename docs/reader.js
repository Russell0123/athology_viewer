const cfg = Object.assign({
  title: '漫畫試閱', author: '',
  startsWithCover: true, endsWithBackCover: true, flipMs: 700, tilt: true,
}, window.BOOK || {});

const $ = (s) => document.querySelector(s);
const stage = $('#stage'), book = $('#book'), view = $('#view');
const pageL = $('#pageL'), pageR = $('#pageR');
const slider = $('#slider'), label = $('#label');
const btnNext = $('#btnNext'), btnPrev = $('#btnPrev'), btnClose = $('#btnClose');
const btnTilt = $('#btnTilt'), btnFull = $('#btnFull');

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FLIP = reduced ? 0 : cfg.flipMs;
document.documentElement.style.setProperty('--flip', FLIP + 'ms');

/* ---------- 頁面資料 ----------
 * vpages：實際排版用的「虛擬頁」。右翻書：偶數索引在左頁、奇數索引在右頁。
 * 每一張紙（leaf）i：正面 = vpages[2i]（在左側時看得到），背面 = vpages[2i+1]。
 * 狀態 k = 已經翻到右邊的紙張數；k=0 闔上（封面），k=L 闔上（封底）。
 */
let files = [], version = '', numPages = 0, ratio = 0.707;
let vpages = [], L = 0;
let tilt = cfg.tilt;
let k = 0, lastOpenK = 1;
let busy = false, busyTarget = 0, queued = null;

function buildPages() {
  vpages = [];
  if (!cfg.startsWithCover) vpages.push({ kind: 'title' }, { kind: 'blank' });
  for (let n = 1; n <= numPages; n++) vpages.push({ kind: 'img', n });
  if (vpages.length % 2) {
    if (cfg.endsWithBackCover && vpages.length > 2) vpages.splice(vpages.length - 1, 0, { kind: 'blank' });
    else vpages.push({ kind: 'blank' });
  }
  L = vpages.length / 2;
}

/* ---------- 圖片預先載入 ---------- */
const srcOf = (n) => `pages/${files[n - 1]}?v=${version}`;
const loaded = new Set(), preloading = new Set();
function preload(nums) {
  for (const n of nums) {
    if (n < 1 || n > numPages || loaded.has(n) || preloading.has(n)) continue;
    preloading.add(n);
    const img = new Image();
    img.onload = () => { loaded.add(n); preloading.delete(n); };
    img.onerror = () => preloading.delete(n);
    img.src = srcOf(n);
  }
}
function prefetch() {
  const c = busy ? busyTarget : k;
  const vs = [];
  for (const d of [0, 1, -1, 2, 3, -2]) vs.push(2 * (c + d) - 1, 2 * (c + d));
  preload(vs.map((v) => vpages[v]).filter((p) => p && p.kind === 'img').map((p) => p.n));
}

/* ---------- 頁面元素 ---------- */
const SHEET = '<div class="sheet"><div class="content"></div><div class="shade"></div><div class="flipshade"></div></div>';
const EDGES = '<div class="edge-side"></div><div class="edge-bottom"></div>';
pageL.innerHTML = pageR.innerHTML = EDGES + SHEET;

function fill(el, v) {
  const content = el.querySelector('.content');
  const p = v == null ? null : vpages[v];
  el.classList.toggle('empty', !p);
  el.classList.toggle('is-cover', v === 0 || v === vpages.length - 1);
  content.className = 'content';
  content.textContent = '';
  if (!p) return;
  if (p.kind === 'img') {
    const img = new Image();
    img.alt = `第 ${p.n} 頁`;
    img.draggable = false;
    img.decoding = 'async';
    if (!loaded.has(p.n)) content.classList.add('loading');
    img.onload = () => { loaded.add(p.n); content.classList.remove('loading'); };
    img.src = srcOf(p.n);
    content.appendChild(img);
  } else if (p.kind === 'title') {
    content.classList.add('title-cover');
    const box = document.createElement('div');
    const h = document.createElement('h2'); h.textContent = cfg.title;
    const a = document.createElement('p'); a.textContent = cfg.author;
    box.append(h, a);
    content.appendChild(box);
  }
}

function setEdges(leftCount, rightCount) {
  // 頁疊厚度：翻開時隨兩側頁數變化（最多 5px），闔上時只留一條細邊
  const closed = leftCount < 0 || rightCount < 0;
  const t = (c) => `calc(${c <= 0 ? 0 : closed ? 2 : Math.min(5, 1 + c * 0.35)}px * var(--s))`;
  book.style.setProperty('--tl', t(leftCount));
  book.style.setProperty('--tr', t(rightCount));
}
function setBookPos(t) {
  book.classList.toggle('at-front', t === 0);
  book.classList.toggle('at-back', t === L);
}

/* ---------- 翻頁 ---------- */
function render() {
  fill(pageL, k < L ? 2 * k : null);
  fill(pageR, k > 0 ? 2 * k - 1 : null);
  setEdges(L - k - 1, k - 1);
  setBookPos(k);
  book.querySelectorAll('.flipper').forEach((f) => f.remove());
}

const MAX_FLIPPING = 6;   // 一次翻很多頁時，最多畫出幾張正在翻的紙
function makeFlipper(leaf) {
  const f = document.createElement('div');
  f.className = 'flipper';
  f.innerHTML = `<div class="face front left">${SHEET}</div><div class="face back right">${SHEET}</div>`;
  fill(f.querySelector('.front'), 2 * leaf);
  fill(f.querySelector('.back'), 2 * leaf + 1);
  book.appendChild(f);
  return f;
}

function go(target) {
  target = Math.max(0, Math.min(L, target));
  if (busy) { queued = target; return; }
  if (target === k) return;
  if (!FLIP) { k = target; render(); afterMove(); return; }

  busy = true; busyTarget = target;
  const fwd = target > k;
  // 要翻動的紙（依翻動順序）：往前翻時由左翻到右，往回翻時由右翻回左
  const leaves = [];
  if (fwd) for (let i = k; i < target; i++) leaves.push(i);
  else for (let i = k - 1; i >= target; i--) leaves.push(i);
  // 翻很多頁時，只挑幾張平均分布的紙來畫（第一張和最後一張一定是真正的頁面）
  const n = leaves.length;
  const shown = n <= MAX_FLIPPING ? leaves
    : Array.from({ length: MAX_FLIPPING }, (_, i) => leaves[Math.round((i * (n - 1)) / (MAX_FLIPPING - 1))]);

  // 底下不動的頁面直接換成翻完後會露出來的那一頁
  if (fwd) {
    fill(pageL, target < L ? 2 * target : null);
    setEdges(L - target - 1, k - 1);
  } else {
    fill(pageR, target > 0 ? 2 * target - 1 : null);
    setEdges(L - k - 1, target - 1);
  }

  const multi = shown.length > 1;
  const dur = multi ? Math.round(FLIP * 0.7) : FLIP;
  const gap = multi ? Math.min(110, Math.round((FLIP * 0.9) / (shown.length - 1))) : 0;
  const count = shown.length;
  const flips = shown.map((leaf, i) => {
    const f = makeFlipper(leaf);
    f.style.setProperty('--flip', dur + 'ms');
    f.style.zIndex = 10 + count - i;   // 還沒翻過去時：先翻的在上面
    f.style.transition = 'none';
    f.style.transform = `translateZ(1px) rotateY(${fwd ? 0 : 180}deg)`;
    f.classList.add('on');
    return f;
  });
  void book.offsetWidth;
  flips.forEach((f, i) => {
    setTimeout(() => {
      f.style.transition = '';
      if (multi) f.style.transitionTimingFunction = 'ease-in-out';
      f.classList.add(fwd ? 'fwd' : 'bwd');
      f.style.transform = `translateZ(1px) rotateY(${fwd ? 180 : 0}deg)`;
      // 翻過中線後落到另一側：後翻的要疊在上面
      if (multi) setTimeout(() => { f.style.zIndex = 20 + count + i; }, dur / 2);
    }, i * gap);
  });
  setBookPos(target);
  prefetch();
  updateUI(target);

  setTimeout(() => {
    k = target; busy = false;
    render();
    afterMove();
    if (queued != null) { const q = queued; queued = null; go(q); }
  }, (count - 1) * gap + dur + 30);
}

const baseK = () => (busy ? (queued ?? busyTarget) : k);
const next = () => go(baseK() + 1);
const prev = () => go(baseK() - 1);
const goFirst = () => go(0);
const goLast = () => go(L);

function toggleClose() {
  const c = baseK();
  if (c === 0) go(lastOpenK > 0 && lastOpenK < L ? lastOpenK : 1);
  else if (c === L) go(lastOpenK > 0 && lastOpenK < L ? lastOpenK : L - 1);
  else { lastOpenK = c; go(0); }
}

function pageName(v) {
  const p = vpages[v];
  if (!p) return '';
  if (v === 0) return '封面';
  if (v === vpages.length - 1 && (cfg.endsWithBackCover || p.kind !== 'img')) return '封底';
  return p.kind === 'img' ? String(p.n) : '';
}
function labelFor(pos) {
  if (pos === 0) return '封面';
  if (pos === L) return '封底';
  const names = [pageName(2 * pos - 1), pageName(2 * pos)].filter(Boolean);
  return names.join('–') + ` / ${numPages}`;
}

const ICON = {
  open: '<svg viewBox="0 0 24 24"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/></svg>',
  closed: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M15 3v18"/></svg>',
  tilt: '<svg viewBox="0 0 24 24"><path d="M6 6h12l3 13H3z"/><path d="M12 6v13"/></svg>',
  flat: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M12 5v14"/></svg>',
};

function updateUI(pos = k) {
  slider.max = L;
  slider.value = pos;
  label.textContent = labelFor(pos);
  btnNext.disabled = pos >= L;
  btnPrev.disabled = pos <= 0;
  $('.hint-next').classList.toggle('off', pos >= L);
  $('.hint-prev').classList.toggle('off', pos <= 0);
  const closed = pos === 0 || pos === L;
  btnClose.innerHTML = closed ? ICON.open + '<span class="txt">打開</span>' : ICON.closed + '<span class="txt">闔上</span>';
  btnClose.title = closed ? '打開書本' : '闔上書本';
  btnTilt.innerHTML = tilt ? ICON.flat + '<span class="txt">平面</span>' : ICON.tilt + '<span class="txt">傾斜</span>';
  btnTilt.title = tilt ? '切換成正面平視' : '切換成傾斜視角';
}

function afterMove() {
  if (k > 0 && k < L) lastOpenK = k;
  updateUI();
  prefetch();
}

/* ---------- 版面 ---------- */
function layout() {
  view.classList.toggle('tilted', tilt);
  const w = stage.clientWidth, h = stage.clientHeight;
  const pad = Math.max(16, Math.min(w, h) * 0.04);
  const aw = w - pad * 2 - 28, ah = h - pad * 2 - 8;
  // 傾斜時書的下緣會變寬、整體高度變矮
  const pw = Math.max(60, tilt ? Math.min(aw / 2 / 1.12, (ah / 0.95) * ratio) : Math.min(aw / 2, ah * ratio));
  // 傾斜時先用兩倍大小繪製，再在傾斜的同時縮回原尺寸：瀏覽器有更多像素可用，畫質比較清楚
  const S = tilt ? 2 : 1;
  const root = document.documentElement.style;
  root.setProperty('--s', S);
  root.setProperty('--pw', (pw * S).toFixed(1) + 'px');
  root.setProperty('--ph', (pw * S / ratio).toFixed(1) + 'px');
}
/* ---------- 縮放 ---------- */
const zoomer = $('#zoomer');
const ZMIN = 1, ZMAX = 4;
const zoom = { z: 1, x: 0, y: 0 };
const clampZ = (z) => Math.max(ZMIN, Math.min(ZMAX, z));

function setZoom(z, x, y, smooth = false) {
  z = clampZ(z);
  if (z < 1.01) { z = 1; x = 0; y = 0; }
  // 不讓畫面被拖到看不見
  const w = stage.clientWidth, h = stage.clientHeight;
  x = Math.min(0, Math.max(w * (1 - z), x));
  y = Math.min(0, Math.max(h * (1 - z), y));
  Object.assign(zoom, { z, x, y });
  zoomer.classList.toggle('smooth', smooth);
  zoomer.style.transform = z === 1 ? '' : `translate(${x}px, ${y}px) scale(${z})`;
  stage.classList.toggle('zoomed', z > 1);
  $('#btnZoomReset').textContent = Math.round(z * 100) + '%';
  $('#btnZoomOut').disabled = z <= ZMIN;
  $('#btnZoomIn').disabled = z >= ZMAX;
}
// 以畫面上的某一點（ax, ay：相對於閱讀區）為中心縮放
function zoomAt(factor, ax, ay, smooth = false) {
  const z = clampZ(zoom.z * factor);
  const r = z / zoom.z;
  setZoom(z, ax - (ax - zoom.x) * r, ay - (ay - zoom.y) * r, smooth);
}
const zoomCenter = (factor) => zoomAt(factor, stage.clientWidth / 2, stage.clientHeight / 2, true);
const resetZoom = (smooth = false) => setZoom(1, 0, 0, smooth);

let resizeRaf = 0;
addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    book.classList.add('no-anim');
    resetZoom();
    layout();
    requestAnimationFrame(() => book.classList.remove('no-anim'));
  });
});

/* ---------- 輸入 ---------- */
btnNext.onclick = next;
btnPrev.onclick = prev;
btnClose.onclick = toggleClose;
btnTilt.onclick = () => { tilt = !tilt; resetZoom(); layout(); updateUI(); };
$('#btnZoomIn').onclick = () => zoomCenter(1.25);
$('#btnZoomOut').onclick = () => zoomCenter(1 / 1.25);
$('#btnZoomReset').onclick = () => resetZoom(true);
if (document.fullscreenEnabled) {
  btnFull.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
} else {
  btnFull.hidden = true;
}

slider.addEventListener('input', () => { label.textContent = labelFor(+slider.value); });
slider.addEventListener('change', () => {
  const v = +slider.value;
  go(v);
});

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.altKey || e.ctrlKey || e.metaKey || !vpages.length) return;
  const map = {
    ArrowLeft: next, ArrowRight: prev, PageDown: next, PageUp: prev, ' ': next,
    Home: goFirst, End: goLast, f: () => btnFull.click(), F: () => btnFull.click(),
    '+': () => zoomCenter(1.25), '=': () => zoomCenter(1.25), '-': () => zoomCenter(1 / 1.25), 0: () => resetZoom(true),
  };
  const fn = map[e.key];
  if (fn) { e.preventDefault(); fn(); }
});

// 點一下：左半邊 = 下一頁，右半邊 = 上一頁（右翻書）
function tap(clientX) {
  if (!vpages.length) return;
  const c = baseK();
  if (c === 0) return next();
  if (c === L) return prev();
  const r = stage.getBoundingClientRect();
  clientX < r.left + r.width / 2 ? next() : prev();
}

// 左右滑動：往右滑 = 下一頁、往左滑 = 上一頁（右翻書）
function swipe(dx, dy) {
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
  dx > 0 ? next() : prev();
}

/* 手指：
 *   單指點擊／左右滑動 → 翻頁（放大時也一樣）
 *   兩指 → 捏合縮放，同時拖曳移動畫面
 * 滑鼠：
 *   點擊 → 翻頁；拖曳 → 沒放大時翻頁，放大時移動畫面 */
const ptrs = new Map();
let gesture = null;
const stagePt = (p) => { const r = stage.getBoundingClientRect(); return { x: p.x - r.left, y: p.y - r.top }; };
const mid = (a, b) => stagePt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

stage.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  // 新的一次操作（第一根手指落下）：清掉可能沒收到「放開」的舊手指紀錄
  if (e.isPrimary) { ptrs.clear(); gesture = null; }
  try { stage.setPointerCapture(e.pointerId); } catch {}
  const p = { x: e.clientX, y: e.clientY };
  ptrs.set(e.pointerId, p);
  if (ptrs.size === 1) {
    gesture = { type: 'one', mouse: e.pointerType === 'mouse', x0: p.x, y0: p.y, zx: zoom.x, zy: zoom.y, moved: false };
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const m = mid(a, b);
    gesture = { type: 'two', d0: dist(a, b) || 1, z0: zoom.z, px: (m.x - zoom.x) / zoom.z, py: (m.y - zoom.y) / zoom.z };
  }
});
stage.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId) || !gesture) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture.type === 'one') {
    const dx = e.clientX - gesture.x0, dy = e.clientY - gesture.y0;
    if (Math.hypot(dx, dy) > 10) gesture.moved = true;
    if (gesture.mouse && zoom.z > 1 && gesture.moved) {
      stage.classList.add('panning');
      setZoom(zoom.z, gesture.zx + dx, gesture.zy + dy);
    }
  } else if (gesture.type === 'two' && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const m = mid(a, b);
    // 兩指中間那一點的內容跟著手指走：捏合 = 縮放，一起移動 = 拖曳畫面
    const z = clampZ(gesture.z0 * dist(a, b) / gesture.d0);
    setZoom(z, m.x - gesture.px * z, m.y - gesture.py * z);
  }
});
function endPointer(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  stage.classList.remove('panning');
  if (!gesture) return;
  if (gesture.type === 'two') {
    // 兩指操作結束後，要等手指全部離開才算結束，不會誤翻頁
    if (ptrs.size === 0) gesture = null;
    else gesture = { type: 'done' };
    return;
  }
  if (ptrs.size > 0) return;
  const g = gesture;
  gesture = null;
  if (g.type !== 'one' || e.type !== 'pointerup') return;
  const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
  if (!g.moved) tap(e.clientX);
  else if (!(g.mouse && zoom.z > 1)) swipe(dx, dy);
}
// 手指可能在閱讀區外放開（例如滑到工具列上），所以在整個視窗上監聽
addEventListener('pointerup', endPointer);
addEventListener('pointercancel', endPointer);
stage.addEventListener('lostpointercapture', (e) => { if (ptrs.has(e.pointerId)) endPointer(e); });
// 保險：所有手指都離開螢幕時，一定把狀態清乾淨
function clearTouches(e) {
  if (e.touches.length === 0 && [...ptrs.keys()].length) {
    ptrs.clear();
    gesture = null;
    stage.classList.remove('panning');
  }
}
addEventListener('touchend', clearTouches);
addEventListener('touchcancel', clearTouches);
// iPhone Safari：關掉瀏覽器自己的整頁縮放，避免和書本縮放打架
document.addEventListener('gesturestart', (e) => e.preventDefault());

// 滑鼠滾輪／觸控板
let wheelAcc = 0, wheelLock = 0, wheelReset = 0;
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dx = e.deltaX * unit, dy = e.deltaY * unit;
  const p = stagePt({ x: e.clientX, y: e.clientY });
  if (e.ctrlKey) { zoomAt(Math.exp(-dy * 0.01), p.x, p.y); return; }  // 觸控板捏合
  if (Math.abs(dx) > Math.abs(dy)) {
    if (zoom.z > 1) { setZoom(zoom.z, zoom.x - dx, zoom.y); return; }
    // 觸控板左右滑翻頁（手指往右滑時 deltaX < 0）
    clearTimeout(wheelReset);
    wheelReset = setTimeout(() => { wheelAcc = 0; }, 200);
    if (Date.now() < wheelLock) return;
    wheelAcc += dx;
    if (Math.abs(wheelAcc) > 60) {
      wheelAcc < 0 ? next() : prev();
      wheelAcc = 0;
      wheelLock = Date.now() + Math.max(350, FLIP * 0.6);
    }
    return;
  }
  zoomAt(Math.exp(-dy * 0.0015), p.x, p.y);  // 滾輪上下 = 放大縮小
}, { passive: false });

/* ---------- 啟動 ---------- */
async function start() {
  document.title = cfg.title;
  $('#title').textContent = cfg.title;
  $('#author').textContent = cfg.author;
  try {
    const res = await fetch('pages/pages.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const info = await res.json();
    files = info.pages;
    version = info.version || '';
    numPages = files.length;
    ratio = info.width / info.height;
  } catch (err) {
    console.error(err);
    $('#loading').classList.add('error');
    $('#loadingText').innerHTML = location.protocol === 'file:'
      ? '無法直接用檔案開啟。<br>請上傳到 GitHub Pages，或用本機伺服器開啟。'
      : '找不到頁面圖片（pages/pages.json）。<br>請先執行 convert.py 轉檔。';
    return;
  }

  buildPages();

  // 網址加上 #p=12 可直接開到第 12 頁；沒有的話從封面開始
  const m = location.hash.match(/p=(\d+)/);
  const startV = m ? vpages.findIndex((p) => p.kind === 'img' && p.n === +m[1]) : -1;
  if (startV > 0) k = Math.ceil(startV / 2);

  book.classList.add('no-anim');
  render();
  layout();
  resetZoom();
  afterMove();
  requestAnimationFrame(() => requestAnimationFrame(() => book.classList.remove('no-anim')));
  $('#loading').hidden = true;

  // 在背景把全部頁面載好，翻頁不用等
  setTimeout(() => preload(Array.from({ length: numPages }, (_, i) => i + 1)), 600);
}
start();
