const cfg = Object.assign({
  title: '漫畫試閱', author: '',
  startsWithCover: true, endsWithBackCover: true, flipMs: 700, tilt: true,
}, window.BOOK || {});

const $ = (s) => document.querySelector(s);
const stage = $('#stage'), book = $('#book'), single = $('#single'), view = $('#view');
const pageL = $('#pageL'), pageR = $('#pageR'), flipper = $('#flipper');
const faceF = flipper.querySelector('.front'), faceB = flipper.querySelector('.back');
const slider = $('#slider'), label = $('#label');
const btnNext = $('#btnNext'), btnPrev = $('#btnPrev'), btnClose = $('#btnClose');
const btnMode = $('#btnMode'), btnTilt = $('#btnTilt'), btnFull = $('#btnFull');

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FLIP = reduced ? 0 : cfg.flipMs;
const SLIDE = reduced ? 0 : 260;
document.documentElement.style.setProperty('--flip', FLIP + 'ms');

/* ---------- 頁面資料 ----------
 * vpages：實際排版用的「虛擬頁」。右翻書：偶數索引在左頁、奇數索引在右頁。
 * 每一張紙（leaf）i：正面 = vpages[2i]（在左側時看得到），背面 = vpages[2i+1]。
 * 雙頁模式的狀態 k = 已經翻到右邊的紙張數；k=0 闔上（封面），k=L 闔上（封底）。
 */
let files = [], version = '', numPages = 0, ratio = 0.707;
let vpages = [], L = 0, sList = [];
let mode = 'double', tilt = cfg.tilt;
let k = 0, s = 0, lastOpenK = 1, lastOpenS = 1;
let busy = false, busyTarget = 0, queued = null, flipTimer = 0;

function buildPages() {
  vpages = [];
  if (!cfg.startsWithCover) vpages.push({ kind: 'title' }, { kind: 'blank' });
  for (let n = 1; n <= numPages; n++) vpages.push({ kind: 'img', n });
  if (vpages.length % 2) {
    if (cfg.endsWithBackCover && vpages.length > 2) vpages.splice(vpages.length - 1, 0, { kind: 'blank' });
    else vpages.push({ kind: 'blank' });
  }
  L = vpages.length / 2;
  sList = vpages.map((p, i) => (p.kind === 'blank' && i !== vpages.length - 1 ? -1 : i)).filter((i) => i >= 0);
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
  const vs = [];
  if (mode === 'double') {
    const c = busy ? busyTarget : k;
    for (const d of [0, 1, -1, 2, 3, -2]) vs.push(2 * (c + d) - 1, 2 * (c + d));
  } else {
    for (const d of [0, 1, -1, 2, 3, 4, -2]) vs.push(sList[s + d]);
  }
  preload(vs.map((v) => vpages[v]).filter((p) => p && p.kind === 'img').map((p) => p.n));
}

/* ---------- 頁面元素 ---------- */
const SHEET = '<div class="sheet"><div class="content"></div><div class="shade"></div><div class="flipshade"></div></div>';
const EDGES = '<div class="edge-side"></div><div class="edge-bottom"></div>';
function makePage(cls) {
  const el = document.createElement('div');
  el.className = 'page ' + cls;
  el.innerHTML = EDGES + SHEET;
  return el;
}
pageL.innerHTML = pageR.innerHTML = EDGES + SHEET;
faceF.innerHTML = faceB.innerHTML = SHEET;

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
  const t = (c) => (c > 0 ? Math.min(14, 1.5 + c * 0.6) : 0) + 'px';
  book.style.setProperty('--tl', t(leftCount));
  book.style.setProperty('--tr', t(rightCount));
}
function setBookPos(t) {
  book.classList.toggle('at-front', t === 0);
  book.classList.toggle('at-back', t === L);
}

/* ---------- 雙頁（書本）模式 ---------- */
function renderDouble() {
  fill(pageL, k < L ? 2 * k : null);
  fill(pageR, k > 0 ? 2 * k - 1 : null);
  setEdges(L - k - 1, k - 1);
  setBookPos(k);
  flipper.classList.remove('on', 'fwd', 'bwd');
}

function goDouble(target) {
  target = Math.max(0, Math.min(L, target));
  if (busy) { queued = target; return; }
  if (target === k) return;
  if (!FLIP) { k = target; renderDouble(); afterMove(); return; }

  busy = true; busyTarget = target;
  const fwd = target > k;
  // 翻動中的那張紙：往前翻時由左翻到右，往回翻時由右翻回左
  if (fwd) {
    fill(faceF, 2 * k);
    fill(faceB, 2 * target - 1);
    fill(pageL, target < L ? 2 * target : null);
    setEdges(L - target - 1, k - 1);
  } else {
    fill(faceF, 2 * target);
    fill(faceB, 2 * k - 1);
    fill(pageR, target > 0 ? 2 * target - 1 : null);
    setEdges(L - k - 1, target - 1);
  }
  flipper.classList.remove('fwd', 'bwd');
  flipper.style.transition = 'none';
  flipper.style.transform = `translateZ(1px) rotateY(${fwd ? 0 : 180}deg)`;
  flipper.classList.add('on');
  void flipper.offsetWidth;
  flipper.style.transition = '';
  flipper.classList.add(fwd ? 'fwd' : 'bwd');
  flipper.style.transform = `translateZ(1px) rotateY(${fwd ? 180 : 0}deg)`;
  setBookPos(target);
  prefetch();
  updateUI(target);

  flipTimer = setTimeout(() => {
    k = target; busy = false;
    renderDouble();
    afterMove();
    if (queued != null) { const q = queued; queued = null; goDouble(q); }
  }, FLIP + 30);
}

/* ---------- 單頁模式 ---------- */
function renderSingle(dir = 0) {
  const v = sList[s];
  const el = makePage(v % 2 === 0 ? 'left' : 'right');
  fill(el, v);
  const olds = [...single.children].filter((c) => !c.classList.contains('leaving'));
  single.appendChild(el);
  olds.forEach((old) => {
    if (!dir || !SLIDE) { old.remove(); return; }
    old.classList.add('leaving');
    // 右翻書：往後讀時舊頁往右滑出，新頁從左邊進來
    old.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${dir > 0 ? 35 : -35}%)`, opacity: 0 }],
      { duration: SLIDE, easing: 'ease-in', fill: 'forwards' });
    setTimeout(() => old.remove(), SLIDE + 30);
  });
  if (dir && SLIDE) {
    el.animate([{ transform: `translateX(${dir > 0 ? -35 : 35}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: SLIDE, easing: 'ease-out' });
  }
}
function goSingle(target) {
  target = Math.max(0, Math.min(sList.length - 1, target));
  if (target === s) return;
  const dir = Math.sign(target - s);
  s = target;
  renderSingle(dir);
  afterMove();
}

/* ---------- 共用操作 ---------- */
const baseK = () => (busy ? (queued ?? busyTarget) : k);
function step(d) {
  if (mode === 'double') goDouble(baseK() + d);
  else goSingle(s + d);
}
const next = () => step(1);
const prev = () => step(-1);
function goFirst() { mode === 'double' ? goDouble(0) : goSingle(0); }
function goLast() { mode === 'double' ? goDouble(L) : goSingle(sList.length - 1); }

function isClosedAt(pos) {
  if (mode === 'double') return pos === 0 || pos === L;
  const v = sList[pos];
  return v === 0 || v === vpages.length - 1;
}
function toggleClose() {
  if (mode === 'double') {
    const c = baseK();
    if (c === 0) goDouble(lastOpenK > 0 && lastOpenK < L ? lastOpenK : 1);
    else if (c === L) goDouble(lastOpenK > 0 && lastOpenK < L ? lastOpenK : L - 1);
    else { lastOpenK = c; goDouble(0); }
  } else {
    if (isClosedAt(s)) goSingle(lastOpenS > 0 && lastOpenS < sList.length - 1 ? lastOpenS : 1);
    else { lastOpenS = s; goSingle(0); }
  }
}

// 目前「焦點頁」（切換單頁／跨頁時用來對應位置）
function focusV() {
  if (mode === 'single') return sList[s];
  return k === 0 ? 0 : k === L ? 2 * L - 1 : 2 * k - 1;
}
function applyMode(m) {
  if (busy) { clearTimeout(flipTimer); k = queued ?? busyTarget; busy = false; queued = null; }
  const v = focusV();
  mode = m;
  if (m === 'double') {
    k = Math.ceil(v / 2);
    single.hidden = true; view.hidden = false;
    single.textContent = '';
    book.classList.add('no-anim');
    renderDouble();
    requestAnimationFrame(() => requestAnimationFrame(() => book.classList.remove('no-anim')));
  } else {
    const i = sList.findIndex((x) => x >= v);
    s = i < 0 ? sList.length - 1 : i;
    view.hidden = true; single.hidden = false;
    single.textContent = '';
    renderSingle(0);
  }
  layout();
  afterMove();
}

function pageName(v) {
  const p = vpages[v];
  if (!p) return '';
  if (v === 0) return '封面';
  if (v === vpages.length - 1 && (cfg.endsWithBackCover || p.kind !== 'img')) return '封底';
  return p.kind === 'img' ? String(p.n) : '';
}
function labelFor(pos) {
  if (mode === 'double') {
    if (pos === 0) return '封面';
    if (pos === L) return '封底';
    const names = [pageName(2 * pos - 1), pageName(2 * pos)].filter(Boolean);
    return names.join('–') + ` / ${numPages}`;
  }
  const name = pageName(sList[pos]);
  return /^\d+$/.test(name) ? `${name} / ${numPages}` : name;
}

const ICON = {
  open: '<svg viewBox="0 0 24 24"><path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 6v13.5"/></svg>',
  closed: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M15 3v18"/></svg>',
  single: '<svg viewBox="0 0 24 24"><rect x="7" y="4" width="10" height="16" rx="1"/></svg>',
  double: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="9" height="14" rx="1"/><rect x="12" y="5" width="9" height="14" rx="1"/></svg>',
  tilt: '<svg viewBox="0 0 24 24"><path d="M6 6h12l3 13H3z"/><path d="M12 6v13"/></svg>',
  flat: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M12 5v14"/></svg>',
};

function updateUI(pos = mode === 'double' ? k : s) {
  const max = mode === 'double' ? L : sList.length - 1;
  slider.max = max;
  slider.value = pos;
  label.textContent = labelFor(pos);
  btnNext.disabled = pos >= max;
  btnPrev.disabled = pos <= 0;
  $('.hint-next').classList.toggle('off', pos >= max);
  $('.hint-prev').classList.toggle('off', pos <= 0);
  const closed = isClosedAt(pos);
  btnClose.innerHTML = closed ? ICON.open + '<span class="txt">打開</span>' : ICON.closed + '<span class="txt">闔上</span>';
  btnClose.title = closed ? '打開書本' : '闔上書本';
  btnMode.innerHTML = mode === 'double' ? ICON.single + '<span class="txt">單頁</span>' : ICON.double + '<span class="txt">跨頁</span>';
  btnMode.title = mode === 'double' ? '切換成單頁顯示' : '切換成跨頁（書本）顯示';
  btnTilt.hidden = mode !== 'double';
  btnTilt.innerHTML = tilt ? ICON.flat + '<span class="txt">平面</span>' : ICON.tilt + '<span class="txt">傾斜</span>';
  btnTilt.title = tilt ? '切換成正面平視' : '切換成傾斜視角';
}

function afterMove() {
  if (mode === 'double' && k > 0 && k < L) lastOpenK = k;
  if (mode === 'single' && !isClosedAt(s)) lastOpenS = s;
  updateUI();
  prefetch();
}

/* ---------- 版面 ---------- */
function layout() {
  view.classList.toggle('tilted', tilt);
  const w = stage.clientWidth, h = stage.clientHeight;
  const pad = Math.max(16, Math.min(w, h) * 0.04);
  const aw = w - pad * 2, ah = h - pad * 2 - 8;
  let pw;
  if (mode === 'double') {
    // 傾斜時書的下緣會變寬、整體高度變矮
    pw = tilt ? Math.min((aw - 28) / 2 / 1.12, (ah / 0.95) * ratio) : Math.min((aw - 28) / 2, ah * ratio);
  } else {
    pw = Math.min(aw, ah * ratio);
  }
  pw = Math.max(60, pw);
  const root = document.documentElement.style;
  root.setProperty('--pw', pw.toFixed(1) + 'px');
  root.setProperty('--ph', (pw / ratio).toFixed(1) + 'px');
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
btnMode.onclick = () => { resetZoom(); applyMode(mode === 'double' ? 'single' : 'double'); };
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
  mode === 'double' ? goDouble(v) : goSingle(v);
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

// 點左半邊 = 下一頁，右半邊 = 上一頁（右翻書）；放大時點擊不翻頁，方便拖曳看細節
let suppressClick = 0;
stage.addEventListener('click', (e) => {
  if (!vpages.length || Date.now() < suppressClick || zoom.z > 1) return;
  if (mode === 'double') {
    const c = baseK();
    if (c === 0) return next();
    if (c === L) return prev();
  }
  const r = stage.getBoundingClientRect();
  e.clientX < r.left + r.width / 2 ? next() : prev();
});

// 左右滑動：往右滑 = 下一頁、往左滑 = 上一頁（右翻書）
function swipe(dx, dy) {
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
  dx > 0 ? next() : prev();
}

/* 手指／滑鼠：
 *   一指（或滑鼠）拖曳：沒放大時左右滑翻頁，放大時移動畫面
 *   兩指：捏合縮放 */
const ptrs = new Map();
let gesture = null;
const stagePt = (p) => { const r = stage.getBoundingClientRect(); return { x: p.x - r.left, y: p.y - r.top }; };
const mid = (a, b) => stagePt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function beginDrag(p, noSwipe) {
  gesture = { type: 'drag', x0: p.x, y0: p.y, zx: zoom.x, zy: zoom.y, moved: false, noSwipe };
}
stage.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.target.closest('button, input')) return;
  try { stage.setPointerCapture(e.pointerId); } catch {}
  const p = { x: e.clientX, y: e.clientY };
  ptrs.set(e.pointerId, p);
  if (ptrs.size === 1) beginDrag(p, false);
  else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const m = mid(a, b);
    gesture = { type: 'pinch', d0: dist(a, b) || 1, z0: zoom.z, px: (m.x - zoom.x) / zoom.z, py: (m.y - zoom.y) / zoom.z };
  }
});
stage.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId) || !gesture) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture.type === 'drag') {
    const dx = e.clientX - gesture.x0, dy = e.clientY - gesture.y0;
    if (Math.hypot(dx, dy) > 8) gesture.moved = true;
    if (zoom.z > 1 && gesture.moved) {
      stage.classList.add('panning');
      setZoom(zoom.z, gesture.zx + dx, gesture.zy + dy);
    }
  } else if (ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const m = mid(a, b);
    // 捏合時讓手指中間那一點的內容跟著手指走
    const z = clampZ(gesture.z0 * dist(a, b) / gesture.d0);
    setZoom(z, m.x - gesture.px * z, m.y - gesture.py * z);
  }
});
function endPointer(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  stage.classList.remove('panning');
  if (!gesture) return;
  if (gesture.type === 'pinch') {
    suppressClick = Date.now() + 400;
    // 放開一指後剩下的那一指可以繼續拖曳，但不會觸發翻頁
    if (ptrs.size === 1) beginDrag([...ptrs.values()][0], true);
    else gesture = null;
    return;
  }
  if (ptrs.size === 0) {
    if (gesture.moved) {
      suppressClick = Date.now() + 400;
      if (zoom.z === 1 && !gesture.noSwipe && e.type === 'pointerup') swipe(e.clientX - gesture.x0, e.clientY - gesture.y0);
    }
    gesture = null;
  }
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

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
  renderDouble();
  layout();
  resetZoom();
  afterMove();
  requestAnimationFrame(() => requestAnimationFrame(() => book.classList.remove('no-anim')));
  $('#loading').hidden = true;

  // 在背景把全部頁面載好，翻頁不用等
  setTimeout(() => preload(Array.from({ length: numPages }, (_, i) => i + 1)), 600);
}
start();
