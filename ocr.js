// Auto EXP reader: shares the game window, reads the level-progress % (e.g. "67.46%") with a
// small template matcher built from a known HUD screenshot, and turns it into EXP per hour.
(() => {
  const $ = (id) => document.getElementById(id);
  const GW = 8, GH = 12;
  const KEY_RECT = 'ocr.rect.v1';
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
  const num = (s) => { const n = parseFloat(String(s ?? '').replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : null; };
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const short = (n) => n >= 1e8 ? (n / 1e8).toFixed(2) + ' 億' : n >= 1e6 ? Math.round(n / 1e4) + ' 萬' : n >= 1e4 ? (n / 1e4).toFixed(1) + ' 萬' : fmt(n);
  const dur = (min) => { if (!Number.isFinite(min) || min < 0) return '—'; const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} 小時 ${m} 分` : `${m} 分`; };

  /* ---------- Glyph matching ---------- */
  function binarize(src, x, y, w, h, thr) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, x, y, w, h, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const m = [];
    for (let j = 0; j < h; j++) {
      const row = new Uint8Array(w);
      for (let i = 0; i < w; i++) { const k = (j * w + i) * 4; row[i] = Math.min(d[k], d[k + 1], d[k + 2]) > thr ? 1 : 0; }
      m.push(row);
    }
    return m;
  }
  function glyphs(m) {
    const h = m.length, w = m[0].length;
    const col = new Array(w).fill(0);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) col[i] += m[j][i];
    const segs = []; let s = -1;
    for (let i = 0; i <= w; i++) {
      const on = i < w && col[i] > 0;
      if (on && s < 0) s = i;
      if (!on && s >= 0) { segs.push([s, i]); s = -1; }
    }
    // The pixel font leaves 1px gaps inside some digits (0, 8, 9); join those pieces.
    const merged = [];
    for (const sg of segs) { const last = merged[merged.length - 1]; if (last && sg[0] - last[1] <= 1) last[1] = sg[1]; else merged.push([...sg]); }
    return merged.map(([a, b]) => {
      let top = h, bot = -1;
      for (let j = 0; j < h; j++) for (let i = a; i < b; i++) if (m[j][i]) { top = Math.min(top, j); bot = Math.max(bot, j); }
      return { a, b, top, bot };
    }).filter((g) => g.bot >= 0);
  }
  function features(m, gl, lineH) {
    const { a, b, top, bot } = gl, w = b - a, h = bot - top + 1, v = [];
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) v.push(m[top + Math.floor((y + 0.5) * h / GH)][a + Math.floor((x + 0.5) * w / GW)]);
    return { v, ar: w / h, rh: h / lineH, ry: (top + bot) / 2 / lineH };
  }
  // Keep only the densest horizontal band of lit rows, so bits of the EXP bar or
  // background caught in a loose box don't become extra "characters".
  function keepTextBand(m) {
    const rows = m.map((r) => r.reduce((s, v) => s + v, 0));
    let best = null, cur = null;
    for (let j = 0; j <= rows.length; j++) {
      if (j < rows.length && rows[j] > 0) { cur ??= { a: j, sum: 0, gap: 0 }; cur.sum += rows[j]; cur.b = j; cur.gap = 0; }
      else if (cur && j < rows.length && ++cur.gap <= 2) { /* tolerate a 1–2 row gap inside a glyph */ }
      else if (cur) { if (!best || cur.sum > best.sum) best = cur; cur = null; }
    }
    if (best) m.forEach((r, j) => { if (j < best.a || j > best.b) r.fill(0); });
    return m;
  }

  function readLine(src, r, thr) {
    const m = keepTextBand(binarize(src, r.x, r.y, r.w, r.h, thr));
    const gs = glyphs(m);
    if (!gs.length) return [];
    const lineH = Math.max(...gs.map((g) => g.bot - g.top + 1));
    return gs.map((g) => features(m, g, lineH));
  }

  // Known text in assets/ocr/sample-1.webp (1792×1001), used as templates.
  const SAMPLES = [
    { src: 'assets/ocr/sample-1.webp', lines: [
      [{ x: 418, y: 890, w: 420, h: 36 }, '22,940,101/34,007,376'],
      [{ x: 280, y: 928, w: 100, h: 30 }, '67.46%'],
      [{ x: 562, y: 955, w: 215, h: 30 }, '208,171,089'],
      [{ x: 905, y: 925, w: 135, h: 25 }, '41/541'],
    ] },
    // Zoomed capture of the progress % from the live reader (523×471).
    { src: 'assets/ocr/sample-2.png', lines: [
      [{ x: 98, y: 319, w: 214, h: 43 }, '68.72%'],
    ] },
  ];
  let templates = [];
  let templatesReady = null;
  const loadImage = (src) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src; });
  function loadTemplates() {
    templatesReady ??= (async () => {
      const list = [];
      for (const s of SAMPLES) {
        const img = await loadImage(s.src);
        for (const [r, text] of s.lines) readLine(img, r, 170).slice(0, text.length).forEach((f, i) => list.push({ c: text[i], ...f }));
      }
      templates = list;
      return list;
    })();
    return templatesReady;
  }
  function classify(f) {
    let best = null, bd = Infinity;
    for (const t of templates) {
      let d = 0;
      for (let i = 0; i < t.v.length; i++) d += t.v[i] !== f.v[i];
      d += Math.abs(Math.log(t.ar / f.ar)) * 20 + Math.abs(t.rh - f.rh) * 30 + Math.abs(t.ry - f.ry) * 30;
      if (d < bd) { bd = d; best = t; }
    }
    return { c: best.c, d: bd };
  }
  // Reads "NN.NN%" from a region; tries a few thresholds since backgrounds differ by map.
  function readPercent(src, r) {
    for (const thr of [170, 150, 190, 210, 130]) {
      const fs = readLine(src, r, thr);
      if (fs.length < 4 || fs.length > 8) continue;
      const cs = fs.map(classify);
      if (cs.some((x) => x.d > 60)) continue;
      const text = cs.map((x) => x.c).join('').replace(/,/g, '.');
      const m = text.match(/^(\d{1,3})\.(\d{2})%?$/);
      if (m) { const p = parseFloat(m[1] + '.' + m[2]); if (p >= 0 && p < 100) return { p, text }; }
    }
    return null;
  }

  window.expOcr = { readPercent, loadTemplates, debug: (src, r, thr = 170) => readLine(src, r, thr).map((f) => { const c = classify(f); return c.c + Math.round(c.d) + '(' + f.ar.toFixed(2) + ')'; }).join(' ') }; // for console checks

  /* ---------- Capture + selection ---------- */
  const video = document.createElement('video'); video.muted = true; video.playsInline = true;
  const prev = $('ocr-preview'), pg = prev.getContext('2d');
  const zoom = $('ocr-zoom'), zg = zoom.getContext('2d');
  let stream = null, rect = load(KEY_RECT, null), drag = null, loopId = null;
  const frameSrc = () => video;

  function drawPreview() {
    if (!stream) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return;
    prev.width = prev.clientWidth * devicePixelRatio; prev.height = prev.width * vh / vw;
    pg.drawImage(video, 0, 0, prev.width, prev.height);
    const r = drag ? drag.rect : rect;
    if (r) {
      const sx = prev.width, sy = prev.height;
      pg.strokeStyle = '#7fe3ff'; pg.lineWidth = 2 * devicePixelRatio;
      pg.strokeRect(r.fx * sx, r.fy * sy, r.fw * sx, r.fh * sy);
    }
    if (rect) {
      const R = toPx(rect);
      zoom.width = Math.min(360, R.w * 3); zoom.height = zoom.width * R.h / R.w;
      zg.imageSmoothingEnabled = false;
      zg.drawImage(video, R.x, R.y, R.w, R.h, 0, 0, zoom.width, zoom.height);
    }
  }
  const toPx = (r) => ({ x: Math.round(r.fx * video.videoWidth), y: Math.round(r.fy * video.videoHeight), w: Math.max(4, Math.round(r.fw * video.videoWidth)), h: Math.max(4, Math.round(r.fh * video.videoHeight)) });

  function pos(e) { const b = prev.getBoundingClientRect(); return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height }; }
  prev.addEventListener('pointerdown', (e) => { if (!stream) return; prev.setPointerCapture(e.pointerId); const p = pos(e); drag = { p0: p, rect: { fx: p.x, fy: p.y, fw: 0, fh: 0 } }; });
  prev.addEventListener('pointermove', (e) => {
    if (!drag) return; const p = pos(e);
    drag.rect = { fx: Math.min(p.x, drag.p0.x), fy: Math.min(p.y, drag.p0.y), fw: Math.abs(p.x - drag.p0.x), fh: Math.abs(p.y - drag.p0.y) };
    drawPreview();
  });
  prev.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.rect.fw > 0.005 && drag.rect.fh > 0.005) { rect = drag.rect; save(KEY_RECT, rect); }
    drag = null; testRead();
  });

  async function testRead() {
    if (!stream || !rect) return;
    await loadTemplates();
    const r = readPercent(frameSrc(), toPx(rect));
    $('ocr-read').textContent = r ? `讀到 ${r.text}` : '讀不到，框小一點、只框住百分比數字';
    $('ocr-read').classList.toggle('error', !r);
    $('ocr-start').disabled = !r;
  }

  $('ocr-share').addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) { $('ocr-read').textContent = '這個瀏覽器不支援分享畫面，請用電腦版 Chrome 或 Edge。'; return; }
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    } catch { $('ocr-read').textContent = '沒有分享畫面。'; return; }
    video.srcObject = stream; await video.play();
    stream.getVideoTracks()[0].addEventListener('ended', stopCapture);
    $('ocr-stage').hidden = false;
    $('ocr-share').textContent = '換一個視窗';
    loadTemplates();
    clearInterval(loopId); loopId = setInterval(() => { drawPreview(); }, 500);
    setTimeout(() => { drawPreview(); testRead(); }, 600);
  });

  /* ---------- Measuring ---------- */
  let run = null;
  $('ocr-start').addEventListener('click', () => {
    if (run) return finish();
    run = { samples: [], offset: 0, last: null, t0: Date.now(), need: num($('exp-need').value) };
    $('ocr-start').textContent = '停止並存檔';
    $('ocr-start').classList.remove('primary');
    tick(); run.timer = setInterval(tick, 3000);
  });

  async function tick() {
    if (!run || !stream) return;
    await loadTemplates();
    const r = readPercent(frameSrc(), toPx(rect));
    const now = Date.now();
    if (!r) { $('ocr-read').textContent = '這次沒讀到，繼續偵測中…'; return; }
    let p = r.p + run.offset;
    if (run.last != null) {
      // Big drop = leveled up. Big jump in one tick = misread.
      if (r.p + run.offset < run.last - 50) { run.offset += 100; p = r.p + run.offset; }
      else if (p - run.last > 15 || p < run.last - 0.5) { $('ocr-read').textContent = `略過一次可疑讀數（${r.text}）`; return; }
    }
    run.last = p;
    run.samples.push({ t: now, p });
    $('ocr-read').textContent = `讀到 ${r.text}`;
    $('ocr-read').classList.remove('error');
    render();
  }

  function rate(windowMin) {
    const s = run.samples; if (s.length < 2) return null;
    const end = s[s.length - 1];
    let first = s[0];
    if (windowMin) first = s.find((x) => x.t >= end.t - windowMin * 60000) || s[0];
    const min = (end.t - first.t) / 60000;
    return min > 0 ? (end.p - first.p) / min : null; // % per minute
  }

  function render() {
    const s = run.samples, need = num($('exp-need').value);
    const total = s.length > 1 ? s[s.length - 1].p - s[0].p : 0;
    const min = s.length > 1 ? (s[s.length - 1].t - s[0].t) / 60000 : 0;
    const all = rate(), r1 = rate(1), r10 = rate(10);
    const toExp = (pct) => need ? pct / 100 * need : null;
    const cur = s.length ? s[s.length - 1].p % 100 : null;
    const left = all > 0 && cur != null ? (100 - cur) / all : null;
    const line = (label, pctPerMin) => pctPerMin == null ? '' :
      `<dt>${label}</dt><dd class="num">${need ? short(toExp(pctPerMin) * 60) + ' / 時' : (pctPerMin * 60).toFixed(2) + '% / 時'}</dd>`;
    $('ocr-stats').innerHTML = `
      <div class="big">${all == null ? '…' : need ? short(toExp(all) * 60) : (all * 60).toFixed(2) + '%'}<small> / 小時</small></div>
      <dl class="kv">
        <dt>已測</dt><dd>${dur(min)}・${s.length} 筆</dd>
        <dt>累積</dt><dd class="num">${total.toFixed(2)}%${need ? '（' + fmt(toExp(total)) + '）' : ''}</dd>
        ${line('最近 1 分鐘', r1)}${line('最近 10 分鐘', r10)}
        <dt>升級還要</dt><dd>${dur(left)}</dd>
      </dl>
      ${need ? '' : '<p class="note">填上方的「這級升級需要」才能換算成經驗值。</p>'}`;
    drawSpark();
  }

  function drawSpark() {
    const c = $('ocr-spark'), g = c.getContext('2d'), s = run.samples;
    c.width = c.clientWidth * devicePixelRatio; c.height = c.clientHeight * devicePixelRatio;
    g.clearRect(0, 0, c.width, c.height);
    if (s.length < 2) return;
    const t0 = s[0].t, t1 = s[s.length - 1].t, p0 = s[0].p, p1 = s[s.length - 1].p || p0 + 1;
    const css = getComputedStyle(document.documentElement);
    g.strokeStyle = css.getPropertyValue('--soul').trim(); g.lineWidth = 2 * devicePixelRatio;
    g.beginPath();
    s.forEach((x, i) => {
      const X = (x.t - t0) / Math.max(1, t1 - t0) * c.width;
      const Y = c.height - (x.p - p0) / Math.max(0.01, p1 - p0) * (c.height - 4) - 2;
      i ? g.lineTo(X, Y) : g.moveTo(X, Y);
    });
    g.stroke();
  }

  function finish() {
    clearInterval(run.timer);
    const s = run.samples, need = num($('exp-need').value);
    if (s.length >= 2 && need) {
      const gainedPct = s[s.length - 1].p - s[0].p, minutes = (s[s.length - 1].t - s[0].t) / 60000;
      window.expTool?.addRun({
        map: $('exp-map').value.trim() || '未填地圖', lv: num($('exp-lv').value),
        gained: gainedPct / 100 * need, minutes, approx: run.offset > 0,
      });
    } else if (s.length >= 2) {
      $('ocr-read').textContent = '沒填「這級升級需要」，這次只顯示百分比，沒有存進紀錄。';
    }
    run = null;
    $('ocr-start').textContent = '開始偵測';
    $('ocr-start').classList.add('primary');
  }

  function stopCapture() {
    if (run) finish();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null; clearInterval(loopId);
    $('ocr-stage').hidden = true; $('ocr-share').textContent = '分享遊戲畫面';
  }
  $('ocr-stop-share').addEventListener('click', stopCapture);
})();
