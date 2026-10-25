// Tabs, level-based map finder and essence table, all rendered from data/site.json.
const FAMILIES = [
  { key: 'Life', zh: '生命', c: 'var(--life)' },
  { key: 'Raging', zh: '狂怒', c: 'var(--raging)' },
  { key: 'Eternal', zh: '永恆', c: 'var(--eternal)' },
  { key: 'Ghostly', zh: '靈魂', c: 'var(--ghostly)' },
  { key: 'Metal', zh: '金屬', c: 'var(--metal)' },
  { key: 'Historic', zh: '歷史', c: 'var(--historic)' },
  { key: 'Nurturing', zh: '滋養', c: 'var(--nurturing)' },
];
const TIERS = [
  { key: 'Dull', zh: 'Dull', c: 'var(--dull)' },
  { key: 'Normal', zh: '一般', c: 'var(--normal)' },
  { key: 'Radiant', zh: '光輝', c: 'var(--radiant)' },
];
const RECIPES = [
  ['生命', 7, '橡木 ×3 + 蘋果 + 棉花球'],
  ['滋養', 15, '椰子木 ×3 + 椰子 + 海葡萄'],
  ['狂怒', 25, '硫磺木 ×3 + 斑點番茄 + 銀葉'],
  ['歷史', 30, '金合歡木 ×3 + 蘆薈 + 鳳梨'],
  ['永恆', 38, '迷霧木 ×3 + 迷霧果 + 燈籠球莖'],
];
const famOf = (key) => FAMILIES.find((f) => f.key === key);
const tierOf = (key) => TIERS.find((t) => t.key === key);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

let DATA = null;
let byName = new Map();

/* ---------- Tabs ---------- */
const panels = [...document.querySelectorAll('section.panel')];
const tabLinks = [...document.querySelectorAll('.tabs a')];
function showTab() {
  const id = location.hash.slice(1);
  const target = panels.find((p) => p.id === id) ? id : 'maps';
  panels.forEach((p) => { p.hidden = p.id !== target; });
  tabLinks.forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + target));
  if (a11yMoved) window.scrollTo({ top: 0 });
  if (tabLinks.some((a) => a.hasAttribute('aria-current'))) {
    tabLinks.find((a) => a.hasAttribute('aria-current')).setAttribute('aria-current', 'page');
  }
}
let a11yMoved = false;
window.addEventListener('hashchange', () => { a11yMoved = true; showTab(); });
showTab();

/* ---------- Shared bits ---------- */
function icon(mon, size = 'icon') {
  const label = mon.zh || mon.name;
  return mon.icon
    ? `<span class="${size}"><img class="sprite" src="${esc(mon.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ph="${esc(label.slice(0, 1))}"></span>`
    : `<span class="${size}"><span class="ph" aria-hidden="true">${esc(label.slice(0, 1))}</span></span>`;
}
function lvText(lv) {
  if (!lv) return '?';
  return lv.lo === lv.hi ? `Lv ${lv.lo}` : `Lv ${lv.lo}–${lv.hi}`;
}
// Essences on a map, each with the best monster drop rate there (rate is null when only the map page lists it).
function mapEssences(map) {
  const set = new Map();
  for (const n of map.monsters) {
    const m = byName.get(n);
    if (!m) continue;
    for (const d of m.drops) {
      if (!d.ess) continue;
      const k = d.ess.tier + d.ess.fam;
      const cur = set.get(k);
      if (!cur || (d.rate ?? -1) > (cur.rate ?? -1)) set.set(k, { ...d.ess, rate: d.rate, by: m });
    }
  }
  for (const e of map.essences) {
    const m = e.match(/^(Dull |Radiant )?(Life|Raging|Eternal|Ghostly|Metal|Historic|Nurturing) Essence$/i);
    if (m) {
      const tier = m[1] ? m[1].trim() : 'Normal';
      const fam = FAMILIES.find((f) => f.key.toLowerCase() === m[2].toLowerCase()).key;
      if (!set.has(tier + fam)) set.set(tier + fam, { tier, fam, rate: null });
    }
  }
  const order = (e) => FAMILIES.findIndex((f) => f.key === e.fam) * 3 + TIERS.findIndex((t) => t.key === e.tier);
  return [...set.values()].sort((a, b) => order(a) - order(b));
}

/* ---------- Map finder ---------- */
const lvInput = document.getElementById('lv');
const overInput = document.getElementById('over');
const overOut = document.getElementById('over-out');
const results = document.getElementById('map-results');
const filterBox = document.getElementById('ess-filter');
let famFilter = null;

filterBox.innerHTML = `<button type="button" class="chip" aria-pressed="true" data-fam="">全部</button>` +
  FAMILIES.map((f) => `<button type="button" class="chip" style="--c:${f.c}" aria-pressed="false" data-fam="${f.key}"><i class="swatch"></i>${f.zh}</button>`).join('');
filterBox.addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  famFilter = b.dataset.fam || null;
  filterBox.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
  renderFinder();
});

const savedLv = parseInt(store.get('lv'), 10);
if (savedLv > 0) lvInput.value = savedLv;
const savedOver = parseInt(store.get('over'), 10);
if (savedOver >= 0) overInput.value = savedOver;
overOut.textContent = overInput.value;

document.getElementById('lv-down').addEventListener('click', () => { lvInput.value = Math.max(1, (+lvInput.value || 1) - 1); renderFinder(); });
document.getElementById('lv-up').addEventListener('click', () => { lvInput.value = Math.min(250, (+lvInput.value || 0) + 1); renderFinder(); });
lvInput.addEventListener('input', renderFinder);
document.querySelector('.route').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-lv]');
  if (!b) return;
  lvInput.value = b.dataset.lv;
  renderFinder();
  document.getElementById('map-results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});
overInput.addEventListener('input', () => { overOut.textContent = overInput.value; renderFinder(); });

function mapCard(map, L, kind) {
  const mobs = map.monsters.map((n) => byName.get(n) || { name: n, zh: DATA.zh?.[n] || null }).sort((a, b) => (a.level ?? 999) - (b.level ?? 999));
  const ess = mapEssences(map);
  const badgeCls = kind === 'over' ? 'badge hard' : kind === 'fit' ? 'badge hot' : 'badge';
  return `<article class="map-card">
    <div class="map-top"><h3>${esc(map.name)}</h3><span class="${badgeCls}">${lvText(map.level)}</span></div>
    ${map.region ? `<span class="region">${esc(map.region)}</span>` : ''}
    <div class="mobs">${mobs.map((m) => `<div class="mob">${icon(m)}
      <span class="who"><b>${esc(m.zh || m.name)}</b>${m.zh ? `<small>${esc(m.name)}</small>` : ''}</span>
      <span class="lv">${m.level != null ? 'Lv ' + m.level : ''}</span></div>`).join('')}</div>
    ${ess.length ? `<div class="ess">${ess.map((e) => `<span style="--c:${famOf(e.fam).c}"${e.by ? ` title="${esc(e.by.zh || e.by.name)}"` : ''}>${tierOf(e.tier).zh} ${famOf(e.fam).zh}${e.rate != null ? `<b>${e.rate}%</b>` : ''}</span>`).join('')}</div>` : ''}
    ${map.notes ? `<p class="note">${esc(map.notes)}</p>` : ''}
  </article>`;
}

function renderFinder() {
  if (!DATA) return;
  const L = Math.max(1, Math.min(250, parseInt(lvInput.value, 10) || 1));
  const U = +overInput.value;
  store.set('lv', L); store.set('over', U);
  renderEssence();
  const fit = [], over = [], easy = [];
  for (const map of DATA.maps) {
    if (!map.level || !map.monsters.length) continue;
    if (famFilter && !mapEssences(map).some((e) => e.fam === famFilter)) continue;
    const { lo, hi } = map.level;
    if (lo <= L + 2 && hi >= L - 3) fit.push(map);
    else if (lo > L + 2 && lo <= L + U) over.push(map);
    else if (hi < L - 3 && hi >= L - 12) easy.push(map);
  }
  const mid = (m) => (m.level.lo + m.level.hi) / 2;
  fit.sort((a, b) => Math.abs(mid(a) - L) - Math.abs(mid(b) - L));
  over.sort((a, b) => a.level.lo - b.level.lo);
  easy.sort((a, b) => b.level.hi - a.level.hi);
  const group = (title, tag, list, kind) => list.length ? `<div class="group">
      <div class="group-head"><h3>${title}</h3><span class="tag">${tag}</span></div>
      <div class="grid">${list.map((m) => mapCard(m, L, kind)).join('')}</div></div>` : '';
  const html = group('剛好適合', `Lv ${Math.max(1, L - 3)}–${L + 2}`, fit, 'fit') +
    group('越級挑戰', `Lv ${L + 3}–${L + U}`, over, 'over') +
    group('輕鬆刷材料', `Lv ${Math.max(1, L - 12)}–${L - 4}`, easy, 'easy');
  results.innerHTML = html || `<div class="empty">這個等級附近沒有找到地圖。試試調高越級等數，或換一種精華。</div>`;
}

/* ---------- Essence table ---------- */
const essList = document.getElementById('ess-list');
const essSearch = document.getElementById('ess-search');
document.getElementById('ess-recipes').innerHTML = RECIPES.map(([fam, lv, mats]) =>
  `<li><b>${fam}</b> <code>鍊金 Lv${lv}</code> ${mats}</li>`).join('') + '<li><b>靈魂、金屬</b> 沒有配方</li>';
const essReach = document.getElementById('ess-reach');
const essReachLv = document.getElementById('ess-reach-lv');
essReach.checked = store.get('reach') === '1';
essSearch.addEventListener('input', renderEssence);
essReach.addEventListener('change', () => { store.set('reach', essReach.checked ? '1' : '0'); renderEssence(); });

function renderEssence() {
  if (!DATA) return;
  const q = essSearch.value.trim().toLowerCase();
  const match = (m) => !q || m.name.toLowerCase().includes(q) || (m.zh || '').includes(q);
  // "Within reach" uses the map finder's level and over-level allowance.
  const cap = (parseInt(lvInput.value, 10) || 1) + (+overInput.value);
  essReachLv.textContent = `（Lv ${cap} 以下）`;
  const reach = (m) => !essReach.checked || (m.level != null && m.level <= cap);
  essList.innerHTML = FAMILIES.map((f) => {
    const tiers = TIERS.map((t) => {
      const rows = [];
      for (const m of DATA.monsters) {
        if (!reach(m)) continue;
        for (const d of m.drops) {
          if (d.ess && d.ess.fam === f.key && d.ess.tier === t.key) rows.push({ m, rate: d.rate });
        }
      }
      rows.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
      const best = rows[0];
      const shown = rows.filter((r) => match(r.m));
      const body = shown.length ? shown.map((r) => `<div class="row${r === best ? ' best' : ''}">${icon(r.m)}
          <span class="who"><b>${esc(r.m.zh || r.m.name)}</b> <span class="lv">${r.m.level != null ? 'Lv ' + r.m.level : ''}</span>
          <small>${esc(r.m.zh ? r.m.name + '・' : '')}${esc(r.m.maps.slice(0, 3).join('、') || '地圖未知')}</small></span>
          <span class="rate">${r.rate != null ? r.rate + '%' : '?'}</span>${r === best ? '<span class="star">最高</span>' : ''}</div>`).join('')
        : `<p class="none">${rows.length ? '沒有符合搜尋的怪' : essReach.checked ? '你的等級範圍內沒有' : 'wiki 上還沒有資料'}</p>`;
      return `<div class="tier" style="--tc:${t.c}"><h4>${t.zh}</h4>${body}</div>`;
    }).join('');
    const famIcon = DATA.items[`Dull ${f.key} Essence`];
    return `<article class="fam" style="--c:${f.c}">
      <div class="fam-head">${famIcon ? `<img class="sprite" src="${esc(famIcon)}" alt="" referrerpolicy="no-referrer">` : ''}<h3>${f.zh}精華</h3><span class="region">${f.key} Essence</span></div>
      <div class="tiers">${tiers}</div></article>`;
  }).join('');
}

// A sprite the wiki doesn't have turns into the same letter badge used for monsters without one.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('sprite')) return;
  if (img.dataset.ph) img.replaceWith(Object.assign(document.createElement('span'), { className: 'ph', textContent: img.dataset.ph }));
  else img.remove();
}, true);

/* ---------- Load ---------- */
fetch('data/site.json')
  .then((r) => r.json())
  .then((d) => {
    DATA = d;
    byName = new Map(d.monsters.map((m) => [m.name, m]));
    if (d.updated) document.getElementById('updated').textContent = d.updated;
    renderFinder();
    renderEssence();
  })
  .catch(() => {
    results.innerHTML = '<div class="empty">資料載入失敗，請重新整理頁面。</div>';
  });
