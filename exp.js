// EXP timer: measure EXP per hour on a map, keep a per-device history, summarize by map.
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY_RUNS = 'exp.runs.v1';
  const KEY_TIMER = 'exp.timer.v1';
  const KEY_FORM = 'exp.form.v1';
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (s) => { const n = parseFloat(String(s ?? '').replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : null; };
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  // 1,234,567 → "123.5 萬", 123,456,789 → "1.23 億"
  const short = (n) => n >= 1e8 ? (n / 1e8).toFixed(2) + ' 億' : n >= 1e6 ? Math.round(n / 1e4) + ' 萬' : n >= 1e4 ? (n / 1e4).toFixed(1) + ' 萬' : fmt(n);
  const dur = (min) => {
    if (!Number.isFinite(min) || min < 0) return '—';
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? `${h} 小時 ${m} 分` : `${m} 分`;
  };

  const fields = ['exp-map', 'exp-lv', 'exp-start', 'exp-need', 'exp-end', 'exp-ups', 'exp-min'];
  const form = load(KEY_FORM, {});
  fields.forEach((id) => { if (form[id] != null && $(id)) $(id).value = form[id]; });
  fields.forEach((id) => $(id).addEventListener('input', () => {
    const f = {}; fields.forEach((x) => { f[x] = $(x).value; }); save(KEY_FORM, f);
    if (id === 'exp-ups') $('exp-ups-note').hidden = !(+$('exp-ups').value > 0);
  }));
  $('exp-ups-note').hidden = !(+$('exp-ups').value > 0);

  /* ---------- Timer (survives page reloads) ---------- */
  let timer = load(KEY_TIMER, { acc: 0, since: null });
  const elapsed = () => timer.acc + (timer.since ? Date.now() - timer.since : 0);
  function paint() {
    const s = Math.floor(elapsed() / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    $('exp-clock').textContent = (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(sec).padStart(2, '0');
    const running = !!timer.since;
    $('exp-go').textContent = running ? '計時中…' : elapsed() ? '繼續計時' : '開始計時';
    $('exp-go').disabled = running;
    $('exp-pause').disabled = !running;
    if (elapsed() && !$('exp-min').matches(':focus')) $('exp-min').placeholder = (elapsed() / 60000).toFixed(1) + '（計時）';
  }
  $('exp-go').addEventListener('click', () => {
    if (!timer.since) { timer.since = Date.now(); save(KEY_TIMER, timer); }
    paint();
  });
  $('exp-pause').addEventListener('click', () => {
    if (timer.since) { timer.acc += Date.now() - timer.since; timer.since = null; save(KEY_TIMER, timer); }
    paint();
  });
  $('exp-reset').addEventListener('click', () => {
    timer = { acc: 0, since: null }; save(KEY_TIMER, timer);
    $('exp-min').placeholder = '自動';
    paint();
  });
  setInterval(paint, 1000);
  paint();

  /* ---------- Compute ---------- */
  let runs = load(KEY_RUNS, []);
  const err = (msg) => { $('exp-err').textContent = msg; $('exp-err').hidden = !msg; };

  $('exp-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const map = $('exp-map').value.trim();
    const lv = num($('exp-lv').value);
    const start = num($('exp-start').value);
    const end = num($('exp-end').value);
    const need = num($('exp-need').value);
    const ups = Math.max(0, num($('exp-ups').value) || 0);
    const minutes = num($('exp-min').value) ?? elapsed() / 60000;
    if (!map) return err('先填練功地圖。');
    if (start == null || end == null) return err('開始和結束的經驗都要填。');
    if (!(minutes > 0)) return err('還沒有時間：按「開始計時」，或直接填練了幾分鐘。');
    if (ups > 0 && need == null) return err('中間有升級的話，要填開始那一級的「升級需要」經驗。');
    let gained, approx = false;
    if (ups === 0) gained = end - start;
    else { gained = (need - start) + end + (ups - 1) * need; approx = ups > 1; }
    if (!(gained > 0)) return err('算出來的經驗不是正數，檢查一下開始和結束的數字。');
    err('');
    const perHour = gained / minutes * 60;
    const run = { id: Date.now(), at: new Date().toISOString(), map, lv, gained, minutes, perHour, approx };
    runs.unshift(run); save(KEY_RUNS, runs);
    if (timer.since) { timer.acc += Date.now() - timer.since; timer.since = null; save(KEY_TIMER, timer); }
    showResult(run, need, ups === 0 ? end : null);
    renderTables();
  });

  function showResult(r, need, endNow) {
    const toLevel = need != null && endNow != null && need > endNow ? (need - endNow) / r.perHour * 60 : null;
    $('exp-result').innerHTML = `
      <h3>這次結果</h3>
      <p class="region">${esc(r.map)}${r.lv ? '・Lv ' + r.lv : ''}・${dur(r.minutes)}</p>
      <div class="big">${short(r.perHour)}<small> / 小時</small></div>
      <dl class="kv">
        <dt>總共拿到</dt><dd class="num">${fmt(r.gained)}${r.approx ? '（約）' : ''}</dd>
        <dt>每分鐘</dt><dd class="num">${fmt(r.perHour / 60)}</dd>
        <dt>每小時</dt><dd class="num">${fmt(r.perHour)}</dd>
        ${toLevel != null ? `<dt>照這速度升級還要</dt><dd>${dur(toLevel)}</dd>` : ''}
      </dl>
      <button type="button" class="btn small" data-copy="${r.id}">複製到 DC</button>`;
  }

  const dcLine = (r) => `**${r.map}**${r.lv ? ` Lv${r.lv}` : ''}｜每小時 \`${short(r.perHour)}\`｜${dur(r.minutes)}${r.approx ? '（約）' : ''}`;

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); btn.textContent = '已複製'; }
    catch { btn.textContent = '複製失敗'; }
    setTimeout(() => { btn.textContent = btn.dataset.label || '複製到 DC'; }, 1500);
  }

  function renderTables() {
    // Per-map summary
    const by = new Map();
    for (const r of runs) {
      const g = by.get(r.map) || { map: r.map, n: 0, sum: 0, best: 0, lvs: [] };
      g.n++; g.sum += r.perHour; g.best = Math.max(g.best, r.perHour); if (r.lv) g.lvs.push(r.lv);
      by.set(r.map, g);
    }
    const groups = [...by.values()].sort((a, b) => b.sum / b.n - a.sum / a.n);
    const top = groups[0] ? groups[0].sum / groups[0].n : 1;
    $('exp-summary').innerHTML = groups.length
      ? `<thead><tr><th>地圖</th><th>等級</th><th>平均 / 小時</th><th>最高</th><th>次數</th></tr></thead><tbody>${groups.map((g) => {
          const avg = g.sum / g.n;
          const lv = g.lvs.length ? (Math.min(...g.lvs) === Math.max(...g.lvs) ? g.lvs[0] : `${Math.min(...g.lvs)}–${Math.max(...g.lvs)}`) : '—';
          return `<tr><td><b>${esc(g.map)}</b><span class="bar" style="--w:${(avg / top * 100).toFixed(1)}%"></span></td><td class="num">${lv}</td><td class="num">${short(avg)}</td><td class="num">${short(g.best)}</td><td class="num">${g.n}</td></tr>`;
        }).join('')}</tbody>`
      : '<tbody><tr><td class="none">還沒有紀錄。量完第一次就會出現在這裡。</td></tr></tbody>';

    $('exp-history').innerHTML = runs.length
      ? `<thead><tr><th>時間</th><th>地圖</th><th>等級</th><th>練了</th><th>每小時</th><th></th></tr></thead><tbody>${runs.map((r) => `<tr>
          <td class="num">${new Date(r.at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
          <td>${esc(r.map)}</td><td class="num">${r.lv ?? '—'}</td><td>${dur(r.minutes)}</td>
          <td class="num">${short(r.perHour)}${r.approx ? '*' : ''}</td>
          <td class="actions"><button type="button" class="btn small" data-copy="${r.id}">複製</button><button type="button" class="btn small ghost" data-del="${r.id}" aria-label="刪除這筆">刪除</button></td>
        </tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="none">還沒有紀錄。</td></tr></tbody>';
  }

  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { const r = runs.find((x) => String(x.id) === c.dataset.copy); if (r) copy(dcLine(r), c); return; }
    const d = e.target.closest('[data-del]');
    if (d) { runs = runs.filter((x) => String(x.id) !== d.dataset.del); save(KEY_RUNS, runs); renderTables(); }
  });
  $('exp-copy-all').dataset.label = '全部複製到 DC';
  $('exp-copy-all').addEventListener('click', (e) => {
    if (!runs.length) return;
    copy('## 經驗測速紀錄\n' + runs.map((r) => '> ' + dcLine(r)).join('\n'), e.currentTarget);
  });

  renderTables();

  // The auto reader (ocr.js) saves its runs through here.
  window.expTool = {
    addRun({ map, lv, gained, minutes, approx }) {
      const r = { id: Date.now(), at: new Date().toISOString(), map, lv, gained, minutes, perHour: gained / minutes * 60, approx: !!approx };
      runs.unshift(r); save(KEY_RUNS, runs);
      showResult(r, null, null);
      renderTables();
    },
  };

  fetch('data/site.json').then((r) => r.json()).then((d) => {
    $('exp-map-list').innerHTML = d.maps
      .filter((m) => m.level && m.monsters.length)
      .sort((a, b) => a.level.lo - b.level.lo)
      .map((m) => `<option value="${esc(m.name)}">Lv ${m.level.lo}${m.level.hi !== m.level.lo ? '–' + m.level.hi : ''}</option>`).join('');
  }).catch(() => {});
})();
