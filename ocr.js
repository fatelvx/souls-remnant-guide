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
    return { v, ar: w / h, rh: h / lineH, ry: (top + bot) / 2 / lineH, a, b };
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

  // Drop panel borders and bars: any row or column run much longer than a glyph.
  function clearLines(m) {
    const h = m.length, w = m[0].length;
    for (let j = 0; j < h; j++) {
      let run = 0;
      for (let i = 0; i <= w; i++) {
        if (i < w && m[j][i]) run++;
        else { if (run > Math.max(40, h * 1.5)) m[j].fill(0, i - run, i); run = 0; }
      }
    }
    for (let i = 0; i < w; i++) {
      let run = 0;
      for (let j = 0; j <= h; j++) {
        if (j < h && m[j][i]) run++;
        else { if (run > h * 0.8 && run > 20) for (let k = j - run; k < j; k++) m[k][i] = 0; run = 0; }
      }
    }
    return m;
  }

  // All separate text rows in a region (row gaps of 2+ blank lines split them).
  function rowBands(m) {
    const bands = []; let cur = null, gap = 0;
    m.forEach((row, j) => {
      const on = row.some((v) => v);
      if (on) { if (cur && gap <= 1) cur.b = j; else { cur = { a: j, b: j }; bands.push(cur); } gap = 0; }
      else gap++;
    });
    return bands.filter((b) => b.b - b.a >= 5);
  }

  function readLine(src, r, thr, band) {
    const raw = band ? clearLines(binarize(src, r.x, r.y, r.w, r.h, thr)) : binarize(src, r.x, r.y, r.w, r.h, thr);
    const m = band ? raw.map((row, j) => (j < band.a || j > band.b ? row.fill(0) : row)) : keepTextBand(raw);
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
    // Zoom-panel captures from the live reader (shown at 3×). Also used shrunk back to
    // native size, which is what the reader actually sees in the game frame.
    { src: 'assets/ocr/sample-2.png', scales: [1, 1 / 3], lines: [
      [{ x: 98, y: 319, w: 214, h: 43 }, '68.72%'],
    ] },
    { src: 'assets/ocr/sample-3.png', scales: [1, 1 / 3], lines: [
      [{ x: 93, y: 232, w: 246, h: 48 }, '69.24%'],
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
        for (const k of s.scales || [1]) {
          let src = img;
          if (k !== 1) {
            src = document.createElement('canvas');
            src.width = Math.round(img.width * k); src.height = Math.round(img.height * k);
            src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
          }
          for (const [r, text] of s.lines) {
            const rr = { x: Math.round(r.x * k), y: Math.round(r.y * k), w: Math.round(r.w * k), h: Math.round(r.h * k) };
            const fs = readLine(src, rr, 170);
            // Extra trailing glyphs (e.g. the word "EXP") are fine; too few means the crop missed.
            if (fs.length >= text.length) fs.slice(0, text.length).forEach((f, i) => list.push({ c: text[i], ...f }));
          }
        }
      }
      templates = list.concat(learned);
      return templates;
    })();
    return templatesReady;
  }

  // Glyphs the viewer taught from their own screen ("教它認字"), kept in this browser.
  const KEY_LEARNED = 'ocr.learned.v1';
  const learned = load(KEY_LEARNED, []).map(([c, v, ar, rh, ry]) => ({ c, v: [...v].map(Number), ar, rh, ry }));
  function teach(src, r, text) {
    text = text.replace(/\s/g, '');
    if (/^\d{1,3}[.,]\d{2}$/.test(text)) text += '%';
    for (const thr of [170, 150, 190, 130, 210, 110, 230]) {
      const fs = readLine(src, r, thr);
      if (fs.length !== text.length) continue;
      fs.forEach((f, i) => learned.push({ c: text[i], v: f.v, ar: f.ar, rh: f.rh, ry: f.ry }));
      while (learned.length > 120) learned.shift();
      save(KEY_LEARNED, learned.map((t) => [t.c, t.v.join(''), +t.ar.toFixed(3), +t.rh.toFixed(3), +t.ry.toFixed(3)]));
      templates = templates.filter((t) => !t.learned).concat(learned.map((t) => ({ ...t, learned: true })));
      return true;
    }
    return false;
  }
  function classify(f) {
    let best = { c: '?' }, bd = Infinity;
    for (const t of templates) {
      let d = 0;
      for (let i = 0; i < t.v.length; i++) d += t.v[i] !== f.v[i];
      d += Math.abs(Math.log(t.ar / f.ar)) * 20 + Math.abs(t.rh - f.rh) * 30 + Math.abs(t.ry - f.ry) * 30;
      if (d < bd) { bd = d; best = t; }
    }
    return { c: best.c, d: bd };
  }
  // Reads "NN.NN%" from a region; tries a few thresholds since backgrounds differ by map.
  // Every threshold gets a vote; the reading whose glyphs match their templates best wins.
  function readPercent(src, r) {
    let best = null;
    for (const thr of [110, 130, 150, 170, 190, 210, 230]) {
      const fs = readLine(src, r, thr);
      if (fs.length < 4 || fs.length > 8) continue;
      const cs = fs.map(classify);
      if (cs.some((x) => x.d > 60)) continue;
      const text = cs.map((x) => x.c).join('').replace(/,/g, '.');
      const m = text.match(/^(\d{1,3})\.(\d{2})%?$/);
      if (!m) continue;
      const p = parseFloat(m[1] + '.' + m[2]);
      const score = cs.reduce((s, x) => s + x.d, 0) / cs.length;
      if (p >= 0 && p < 100 && (!best || score < best.score)) best = { p, text, score };
    }
    return best;
  }

  // Reads a line as space-separated words (a wide gap = space), each glyph classified.
  // Connected blobs of lit pixels with their bounding boxes.
  function blobs(m) {
    const h = m.length, w = m[0].length, seen = new Uint8Array(w * h), out = [], stack = [];
    for (let y0 = 0; y0 < h; y0++) for (let x0 = 0; x0 < w; x0++) {
      if (!m[y0][x0] || seen[y0 * w + x0]) continue;
      let x1 = x0, x2 = x0, y1 = y0, y2 = y0, n = 0;
      stack.push(x0, y0); seen[y0 * w + x0] = 1;
      while (stack.length) {
        const y = stack.pop(), x = stack.pop(); n++;
        if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && m[ny][nx] && !seen[ny * w + nx]) { seen[ny * w + nx] = 1; stack.push(nx, ny); }
        }
      }
      if (n >= 2) out.push({ a: x1, b: x2 + 1, top: y1, bot: y2 });
    }
    return out;
  }

  // Reads every text line in a region as words, each glyph classified. Lines are found by
  // grouping blobs of similar height and vertical position, so stacked rows don't merge.
  function readWords(src, r, thr) {
    const m = clearLines(binarize(src, r.x, r.y, r.w, r.h, thr));
    let bs = blobs(m).sort((p, q) => p.a - q.a);
    // Glue pieces of one glyph (the pixel font leaves 1px gaps inside 0, 8, 9).
    const glued = [];
    for (const b of bs) {
      const g = glued.find((x) => b.a - x.b <= 1 && b.a >= x.a && Math.min(b.bot, x.bot) - Math.max(b.top, x.top) >= -1);
      if (g) { g.b = Math.max(g.b, b.b); g.top = Math.min(g.top, b.top); g.bot = Math.max(g.bot, b.bot); } else glued.push({ ...b });
    }
    // Lines: tall blobs (digits) define a line; small ones (, .) join the line they sit in.
    const H = (b) => b.bot - b.top + 1;
    const tall = glued.filter((b) => H(b) >= 6).sort((p, q) => H(q) - H(p));
    const lines = [];
    for (const b of tall) {
      const L = lines.find((l) => Math.abs(H(b) - l.h) <= l.h * 0.25 && Math.abs((b.top + b.bot) / 2 - l.mid) <= l.h * 0.35)
        // a much shorter blob overlapping a taller line (comma, period) belongs to it
        || lines.find((l) => l.h > H(b) * 1.4 && b.top <= l.bot + l.h * 0.4 && b.bot >= l.top);
      if (L) L.items.push(b); else lines.push({ h: H(b), mid: (b.top + b.bot) / 2, top: b.top, bot: b.bot, items: [b] });
    }
    for (const l of lines) { l.top = Math.min(...l.items.map((b) => b.top)); l.bot = Math.max(...l.items.map((b) => b.bot)); }
    for (const b of glued.filter((b) => H(b) < 6 || !tall.includes(b))) {
      const L = lines.find((l) => b.top >= l.top - 1 && b.bot <= l.bot + l.h * 0.4);
      if (L && !L.items.includes(b)) L.items.push(b);
    }
    return lines.sort((p, q) => p.mid - q.mid).map((l) => {
      const items = l.items.sort((p, q) => p.a - q.a);
      const lineH = l.bot - l.top + 1;
      const fs = items.map((g) => features(m, g, lineH));
      fs.forEach((f, i) => { f.ry = ((items[i].top + items[i].bot) / 2 - l.top) / lineH; });
      const gapMax = Math.max(3, l.h * 0.45);
      const words = [[]];
      fs.forEach((f, i) => {
        if (i && items[i].a - items[i - 1].b > gapMax) words.push([]);
        words[words.length - 1].push(classify(f));
      });
      return words.map((w) => ({ text: w.map((x) => x.c).join(''), ok: w.every((x) => x.d <= 60) }));
    });
  }
  const clampRect = (r, W, H) => {
    const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
    return { x, y, w: Math.max(4, Math.min(W - x, Math.round(r.w))), h: Math.max(4, Math.min(H - y, Math.round(r.h))) };
  };
  const srcSize = (src) => ({ W: src.videoWidth || src.width, H: src.videoHeight || src.height });

  // The hover tooltip "22,940,101 / 34,007,376 EXP" sits up and to the right of the % text
  // (and covers part of it). With a % reading, the pair must agree with it.
  function readExpPair(src, pr, pct) {
    const { W, H } = srcSize(src);
    const r = clampRect({ x: pr.x - pr.w * 0.2, y: pr.y - pr.h * 2.4, w: pr.w * 7, h: pr.h * 3 }, W, H);
    const NUM = '(\\d{1,3}(?:,\\d{3})+)';
    for (const thr of [170, 150, 190, 210]) {
      for (const row of readWords(src, r, thr)) {
        const m = row.map((w) => w.text).join(' ').match(new RegExp(NUM + ' ?/ ?' + NUM));
        if (!m) continue;
        const cur = +m[1].replace(/,/g, ''), need = +m[2].replace(/,/g, '');
        if (!(need > 0 && cur < need)) continue;
        if (pct != null && Math.abs(cur / need * 100 - pct) > 0.06) continue;
        return { cur, need };
      }
    }
    return null;
  }

  window.expOcr = { readPercent, readExpPair, readWords, loadTemplates, debug: (src, r, thr = 170) => readLine(src, r, thr).map((f) => { const c = classify(f); return c.c + Math.round(c.d) + '(' + f.ar.toFixed(2) + ')'; }).join(' ') }; // for console checks

  /* ---------- Capture + selection ---------- */
  const video = document.createElement('video'); video.muted = true; video.playsInline = true;
  const prev = $('ocr-preview'), pg = prev.getContext('2d');
  const zoom = $('ocr-zoom'), zg = zoom.getContext('2d');
  let stream = null, rect = load(KEY_RECT, null), drag = null, loopId = null;
  let frameOverride = null; // a canvas/image used instead of the shared screen (testing)
  const frameSrc = () => frameOverride || video;

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
  const toPx = (r) => {
    const { W, H } = srcSize(frameSrc());
    return { x: Math.round(r.fx * W), y: Math.round(r.fy * H), w: Math.max(4, Math.round(r.fw * W)), h: Math.max(4, Math.round(r.fh * H)) };
  };

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

  // One reading of the screen: the % if visible, else the hover tooltip (which covers the %).
  // A tooltip-only reading must agree with the requirement we already know, if any.
  function readNow() {
    const src = frameSrc(), pr = toPx(rect);
    let pair = readExpPair(src, pr, null);
    if (pair && run?.need && pair.need !== run.need && run.last != null && run.lastRaw < 95) pair = null;
    if (!pair) { const pct = readPercent(src, pr); return pct && { p: pct.p, text: pct.text }; }
    const p = Math.floor(pair.cur / pair.need * 10000) / 100;
    return { p, text: `${fmt(pair.cur)} / ${fmt(pair.need)}`, need: pair.need };
  }

  async function testRead() {
    if (!stream || !rect) return;
    await loadTemplates();
    const r = readNow();
    $('ocr-read').textContent = r ? `讀到 ${r.text}` : '讀不到：只框住左下角的百分比數字（框的時候滑鼠先不要停在經驗條上）';
    $('ocr-read').classList.toggle('error', !r);
    $('ocr-start').disabled = !r;
  }

  $('ocr-teach')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!stream || !rect) return;
    await loadTemplates();
    const text = $('ocr-teach-input').value.trim();
    if (!/^\d{1,3}[.,]\d{2}%?$/.test(text)) { $('ocr-read').textContent = '請照畫面輸入，例如 75.33'; return; }
    const ok = teach(frameSrc(), toPx(rect), text);
    $('ocr-teach-input').value = '';
    if (!ok) { $('ocr-read').textContent = '框裡的字數對不上，框小一點、只框住百分比再試一次'; return; }
    testRead();
  });

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

  /* ---------- Floating mini window ---------- */
  // Document Picture-in-Picture (Chrome/Edge 116+) stays on top of other windows, including the
  // game in windowed/borderless mode. Falls back to a video PiP of a small canvas.
  const pip = (() => {
    let win = null, canvas = null, pipVideo = null, last = null;
    const html = (d) => `
      <div class="m">${d.main}<span>/時</span></div>
      <div class="s"><span>近1分 ${d.r1}</span><span>升級 ${d.left}</span><span>${d.pct}</span></div>
      ${d.noNeed ? '<div class="h">移到經驗條上讀取升級經驗</div>' : ''}`;
    function paintCanvas(d) {
      const g = canvas.getContext('2d');
      g.fillStyle = '#12131f'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#7fe3ff'; g.font = '700 44px "Noto Sans TC", sans-serif'; g.fillText(d.main + ' /時', 16, 60);
      g.fillStyle = '#a3a1c0'; g.font = '22px "Noto Sans TC", sans-serif'; g.fillText(`近1分 ${d.r1}・升級 ${d.left}・${d.pct}`, 16, 100);
    }
    return {
      async open() {
        last ??= { main: '…', r1: '…', left: '—', pct: '', noNeed: false };
        if ('documentPictureInPicture' in window) {
          win = await documentPictureInPicture.requestWindow({ width: 260, height: 96 });
          const st = win.document.createElement('style');
          st.textContent = `body{margin:0;padding:8px 12px;background:#12131f;color:#ecebf7;font:13px "Noto Sans TC",system-ui,sans-serif;overflow:hidden}
            .m{font:600 28px/1.1 "Noto Sans TC",system-ui,sans-serif;color:#7fe3ff}.m span{font-size:13px;color:#a3a1c0;margin-left:4px}
            .s{display:flex;gap:10px;color:#a3a1c0;margin-top:4px;white-space:nowrap}.h{color:#ffd24a;font-size:12px;margin-top:2px}`;
          win.document.head.append(st);
          win.document.body.innerHTML = html(last);
          win.addEventListener('pagehide', () => { win = null; });
        } else {
          canvas ??= Object.assign(document.createElement('canvas'), { width: 520, height: 120 });
          paintCanvas(last);
          pipVideo ??= Object.assign(document.createElement('video'), { muted: true, playsInline: true });
          pipVideo.srcObject = canvas.captureStream(2);
          await pipVideo.play();
          await pipVideo.requestPictureInPicture();
        }
      },
      update(d) {
        last = d;
        if (win) win.document.body.innerHTML = html(d);
        else if (canvas && document.pictureInPictureElement === pipVideo) paintCanvas(d);
      },
    };
  })();
  $('ocr-pip')?.addEventListener('click', () => pip.open().catch(() => { $('ocr-read').textContent = '這個瀏覽器開不了小視窗，請用電腦版 Chrome 或 Edge。'; }));

  /* ---------- Measuring ---------- */
  let run = null;
  $('ocr-start').addEventListener('click', () => {
    if (run) return finish();
    run = { samples: [], offset: 0, last: null, lastRaw: null, t0: Date.now(), need: num($('exp-need').value), exp: 0, pendingPct: 0, ups: 0 };
    $('ocr-start').textContent = '停止並存檔';
    $('ocr-start').classList.remove('primary');
    tick(); run.timer = setInterval(tick, 3000);
  });

  // Console test: expOcr.simulate(imageOrCanvas, {fx,fy,fw,fh}) then call expOcr.tick().
  window.expOcr.simulate = (img, r) => { frameOverride = img; rect = r; stream = stream || { getTracks: () => [] }; $('ocr-stage').hidden = false; $('ocr-start').disabled = false; };
  window.expOcr.tick = () => tick();

  async function tick() {
    if (!run || !stream) return;
    await loadTemplates();
    const now = Date.now();
    const r = readNow();
    if (!r) { $('ocr-read').textContent = '這次沒讀到，繼續偵測中…'; return; }

    // Hovering the EXP bar shows "cur / need EXP": pick up the level's requirement automatically.
    if (r.need && r.need !== run.need) setNeed(r.need, '滑鼠移到經驗條上自動讀到');

    let p = r.p + run.offset;
    if (run.last != null) {
      // Big drop = leveled up. Big jump in one tick = misread.
      if (r.p + run.offset < run.last - 50) {
        addPct(100 - run.lastRaw);
        run.offset += 100; run.ups++; p = r.p + run.offset;
        levelUp();
        addPct(r.p);
      } else if (p - run.last > 15 || p < run.last - 0.5) { $('ocr-read').textContent = `略過一次可疑讀數（${r.text}）`; return; }
      else addPct(r.p - run.lastRaw);
    }
    run.last = p; run.lastRaw = r.p;
    run.samples.push({ t: now, p, e: run.pendingPct ? null : run.exp });
    $('ocr-read').textContent = `讀到 ${r.text}`;
    $('ocr-read').classList.remove('error');
    render();
  }

  // EXP is counted per level: % gained times that level's requirement. Gains made before the
  // requirement is known wait in pendingPct and are converted once it is.
  function addPct(dp) {
    if (run.need) run.exp += dp / 100 * run.need;
    else run.pendingPct += dp;
  }
  function setNeed(need, how) {
    run.need = need;
    if (run.pendingPct) {
      run.exp += run.pendingPct / 100 * need; run.pendingPct = 0;
      const p0 = run.samples[0]?.p ?? 0;
      run.samples.forEach((s) => { s.e = (s.p - p0) / 100 * need; });
    }
    $('exp-need').value = fmt(need);
    $('exp-need').dispatchEvent(new Event('input', { bubbles: true }));
    $('exp-need').dispatchEvent(new Event('change', { bubbles: true })); // remembered for this level
    run.needNote = how;
  }
  function levelUp() {
    const lv = num($('exp-lv').value);
    if (lv) { $('exp-lv').value = lv + 1; $('exp-lv').dispatchEvent(new Event('input', { bubbles: true })); }
    run.need = num($('exp-need').value); // filled from the table if this level is known
    run.needNote = run.need ? `Lv ${lv + 1} 已有紀錄` : null;
  }

  // Rate over the last `windowMin` minutes (or all): { pct, exp } per minute.
  function rate(windowMin) {
    const s = run.samples; if (s.length < 2) return null;
    const end = s[s.length - 1];
    const first = windowMin ? (s.find((x) => x.t >= end.t - windowMin * 60000) || s[0]) : s[0];
    const min = (end.t - first.t) / 60000;
    if (!(min > 0)) return null;
    const exp = end.e != null && first.e != null ? (end.e - first.e) / min : null;
    return { pct: (end.p - first.p) / min, exp };
  }

  const perHour = (r) => r == null ? '…' : r.exp != null ? short(r.exp * 60) : (r.pct * 60).toFixed(2) + '%';

  function render() {
    const s = run.samples;
    const min = s.length > 1 ? (s[s.length - 1].t - s[0].t) / 60000 : 0;
    const all = rate(), r1 = rate(1), r10 = rate(10);
    const cur = run.lastRaw;
    const left = all && all.pct > 0 && cur != null ? (100 - cur) / all.pct : null;
    const totalPct = s.length > 1 ? s[s.length - 1].p - s[0].p : 0;
    $('ocr-stats').innerHTML = `
      <div class="big">${perHour(all)}<small> / 小時</small></div>
      <dl class="kv">
        <dt>已測</dt><dd>${dur(min)}・${s.length} 筆</dd>
        <dt>累積</dt><dd class="num">${run.pendingPct ? totalPct.toFixed(2) + '%' : fmt(run.exp)}</dd>
        ${r1 ? `<dt>最近 1 分鐘</dt><dd class="num">${perHour(r1)} / 時</dd>` : ''}
        ${r10 && min > 2 ? `<dt>最近 10 分鐘</dt><dd class="num">${perHour(r10)} / 時</dd>` : ''}
        <dt>升級還要</dt><dd>${dur(left)}</dd>
      </dl>
      <p class="note">${run.need ? `升級需要 ${fmt(run.need)}${run.needNote ? '（' + run.needNote + '）' : ''}` : '滑鼠移到遊戲的經驗條上停一下，就會自動讀到升級需要的經驗。'}</p>`;
    drawSpark();
    pip.update({ main: perHour(all), r1: r1 ? perHour(r1) : '…', left: dur(left), pct: cur != null ? cur.toFixed(2) + '%' : '', noNeed: !run.need });
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
    const s = run.samples;
    if (s.length >= 2 && !run.pendingPct) {
      const minutes = (s[s.length - 1].t - s[0].t) / 60000;
      window.expTool?.addRun({
        map: $('exp-map').value.trim() || '未填地圖', lv: num($('exp-lv').value) - run.ups || null,
        gained: run.exp, minutes, approx: false,
      });
    } else if (s.length >= 2) {
      $('ocr-read').textContent = '還不知道這級升級需要多少經驗，這次只顯示百分比，沒有存進紀錄。下次偵測時滑鼠移到經驗條上一下就好。';
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
