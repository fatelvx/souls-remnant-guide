// Tabs, language switch, level-based map finder and essence table, all rendered from data/site.json.
const FAMILIES = [
  { key: 'Life', zh: '生命', c: 'var(--life)' },
  { key: 'Raging', zh: '狂怒', c: 'var(--raging)' },
  { key: 'Eternal', zh: '永恆', c: 'var(--eternal)' },
  { key: 'Ghostly', zh: '幽靈', c: 'var(--ghostly)' },
  { key: 'Metal', zh: '金屬', c: 'var(--metal)' },
  { key: 'Historic', zh: '歷史', c: 'var(--historic)' },
  { key: 'Nurturing', zh: '滋養', c: 'var(--nurturing)' },
];
const TIERS = [
  { key: 'Dull', zh: '黯淡', c: 'var(--dull)' },
  { key: 'Normal', zh: '一般', c: 'var(--normal)' },
  { key: 'Radiant', zh: '光輝', c: 'var(--radiant)' },
];
// [family, alchemy level, materials as [zh, en, count]]; names are the game's official ones.
const RECIPES = [
  ['Life', 7, [['橡木', 'Oak Wood', 3], ['蘋果', 'Apple'], ['棉球', 'Cotton Ball']]],
  ['Nurturing', 15, [['椰木', 'Coconut Wood', 3], ['椰子', 'Coconut'], ['海葡萄', 'Sea Grapes']]],
  ['Raging', 25, [['硫磺木', 'Sulfuric Wood', 3], ['斑點番茄', 'Spot Tomato'], ['銀葉', 'Silver Leaf']]],
  ['Historic', 30, [['相思木', 'Acacia Wood', 3], ['蘆薈', 'Aloe Vera'], ['菠蘿', 'Pineapple']]],
  ['Eternal', 38, [['迷霧木', 'Misty Wood', 3], ['迷霧果實', 'Misty Fruit'], ['提燈燈泡', 'Lantern Bulb']]],
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

/* ---------- Language ---------- */
// Static text is written twice in index.html (data-l="zh" / data-l="en") and CSS hides the other one;
// everything rendered here goes through T and the name helpers below.
const T = {
  zh: {
    title: "Soul's Remnant 攻略站",
    desc: 'Soul\'s Remnant 練功地圖、精華掉落、拍賣場、元素與染色整理。',
    all: '全部', fit: '適合你的等級', over: '越級挑戰', easy: '低等刷材料',
    noMaps: '這個等級附近沒有找到地圖。可以把越級等數調高，或換一種精華看看。',
    best: '最高', mapUnknown: '地圖未知', noMatch: '沒有符合搜尋的怪',
    noneInReach: '你的等級範圍內沒有會掉這一階的怪', noData: 'wiki 目前沒有資料',
    reach: (cap, lv, over) => `只看我打得到的怪：<span class="lv">Lv ${cap}</span> 以下 <small>（你的等級 ${lv} ＋ 可越級 ${over}，在練功地圖分頁調整）</small>`,
    search: '搜尋怪物（中文或英文）', searchLabel: '搜尋怪物',
    lvDown: '等級減 1', lvUp: '等級加 1', tabs: '攻略分類',
    alchemy: '鍊金', noRecipe: '幽靈、金屬精華沒有配方，只能打怪取得。',
    essence: (f) => `${f.zh}精華`, sep: '、', loadFail: '資料載入失敗，請重新整理頁面。',
  },
  en: {
    title: "Soul's Remnant Guide",
    desc: "Soul's Remnant leveling maps, essence drops, auction house, elements and dyes.",
    all: 'All', fit: 'Right for your level', over: 'A few levels above you', easy: 'Lower-level farming',
    noMaps: 'No maps found around this level. Try allowing more levels above you, or pick another essence.',
    best: 'Top', mapUnknown: 'map unknown', noMatch: 'No monsters match your search',
    noneInReach: 'Nothing within your level range drops this tier', noData: 'No data on the wiki yet',
    reach: (cap, lv, over) => `Only monsters I can fight: <span class="lv">Lv ${cap}</span> and below <small>(your level ${lv} + up to ${over} above, set on the Leveling tab)</small>`,
    search: 'Search monsters', searchLabel: 'Search monsters',
    lvDown: 'Level down', lvUp: 'Level up', tabs: 'Guide sections',
    alchemy: 'Alchemy', noRecipe: 'Ghostly and Metal Essence have no recipe; they only drop from monsters.',
    essence: (f) => `${f.key} Essence`, sep: ', ', loadFail: 'Could not load the data. Please refresh the page.',
  },
};
const fromUrl = new URLSearchParams(location.search).get('lang');
let LANG = fromUrl || store.get('lang') || (/^zh/i.test(navigator.language) ? 'zh' : 'en');
if (LANG !== 'en') LANG = 'zh';
const t = (k) => T[LANG][k];
const zh = () => LANG === 'zh';
// Display name, plus the other language's name as a small subtitle when we're showing Chinese.
const nameOf = (o) => (zh() && o.zh) || o.name;
const subOf = (o) => (zh() && o.zh ? o.name : '');
const famName = (f) => (zh() ? f.zh : f.key);
const tierName = (tr) => (zh() ? tr.zh : tr.key);
const mapName = (name) => (zh() && DATA.maps.find((m) => m.name === name)?.zh) || name;

function applyLang() {
  document.documentElement.lang = zh() ? 'zh-Hant' : 'en';
  document.title = t('title');
  document.querySelector('meta[name="description"]').content = t('desc');
  document.querySelector('.tabs').setAttribute('aria-label', t('tabs'));
  essSearch.placeholder = t('search');
  essSearch.setAttribute('aria-label', t('searchLabel'));
  document.getElementById('lv-down').setAttribute('aria-label', t('lvDown'));
  document.getElementById('lv-up').setAttribute('aria-label', t('lvUp'));
  document.querySelectorAll('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === LANG)));
  renderChips();
  renderRecipes();
  renderFinder();
}
document.querySelector('.lang').addEventListener('click', (e) => {
  const b = e.target.closest('[data-set-lang]');
  if (!b || b.dataset.setLang === LANG) return;
  LANG = b.dataset.setLang;
  store.set('lang', LANG);
  const url = new URL(location.href);
  url.searchParams.set('lang', LANG);
  history.replaceState(null, '', url);
  applyLang();
});

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
  const label = nameOf(mon);
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

function renderChips() {
  filterBox.innerHTML = `<button type="button" class="chip" aria-pressed="${!famFilter}" data-fam="">${t('all')}</button>` +
    FAMILIES.map((f) => `<button type="button" class="chip" style="--c:${f.c}" aria-pressed="${famFilter === f.key}" data-fam="${f.key}"><i class="swatch"></i>${famName(f)}</button>`).join('');
}
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
  const region = zh() ? map.regionZh || map.region : map.region;
  const notes = zh() ? map.notes : map.notesEn || map.notes;
  return `<article class="map-card">
    <div class="map-top"><h3>${esc(nameOf(map))}${subOf(map) ? `<small>${esc(subOf(map))}</small>` : ''}</h3><span class="${badgeCls}">${lvText(map.level)}</span></div>
    ${region ? `<span class="region">${esc(region)}</span>` : ''}
    <div class="mobs">${mobs.map((m) => `<div class="mob">${icon(m)}
      <span class="who"><b>${esc(nameOf(m))}</b>${subOf(m) ? `<small>${esc(subOf(m))}</small>` : ''}</span>
      <span class="lv">${m.level != null ? 'Lv ' + m.level : ''}</span></div>`).join('')}</div>
    ${ess.length ? `<div class="ess">${ess.map((e) => `<span style="--c:${famOf(e.fam).c}"${e.by ? ` title="${esc(nameOf(e.by))}"` : ''}>${tierName(tierOf(e.tier))} ${famName(famOf(e.fam))}${e.rate != null ? `<b>${e.rate}%</b>` : ''}</span>`).join('')}</div>` : ''}
    ${notes ? `<p class="note">${esc(notes)}</p>` : ''}
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
  const html = group(t('fit'), `Lv ${Math.max(1, L - 3)}–${L + 2}`, fit, 'fit') +
    group(t('over'), `Lv ${L + 3}–${L + U}`, over, 'over') +
    group(t('easy'), `Lv ${Math.max(1, L - 12)}–${L - 4}`, easy, 'easy');
  results.innerHTML = html || `<div class="empty">${t('noMaps')}</div>`;
}

/* ---------- Essence table ---------- */
const essList = document.getElementById('ess-list');
const essSearch = document.getElementById('ess-search');
function renderRecipes() {
  const mat = ([z, en, n]) => `${zh() ? z : en}${n ? ` ×${n}` : ''}`;
  document.getElementById('ess-recipes').innerHTML = RECIPES.map(([fam, lv, mats]) =>
    `<li><b>${famName(famOf(fam))}</b> <code>${t('alchemy')} Lv${lv}</code> ${mats.map(mat).join(' + ')}</li>`).join('') +
    `<li class="note">${t('noRecipe')}</li>`;
}
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
  const lv = parseInt(lvInput.value, 10) || 1;
  const cap = lv + (+overInput.value);
  essReachLv.innerHTML = T[LANG].reach(cap, lv, overInput.value);
  const reach = (m) => !essReach.checked || (m.level != null && m.level <= cap);
  essList.innerHTML = FAMILIES.map((f) => {
    const tiers = TIERS.map((tr) => {
      const rows = [];
      for (const m of DATA.monsters) {
        if (!reach(m)) continue;
        for (const d of m.drops) {
          if (d.ess && d.ess.fam === f.key && d.ess.tier === tr.key) rows.push({ m, rate: d.rate });
        }
      }
      rows.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
      const best = rows[0];
      const shown = rows.filter((r) => match(r.m));
      const where = (m) => m.maps.slice(0, 3).map(mapName).join(t('sep')) || t('mapUnknown');
      const body = shown.length ? shown.map((r) => `<div class="row${r === best ? ' best' : ''}">${icon(r.m)}
          <span class="who"><b>${esc(nameOf(r.m))}</b> <span class="lv">${r.m.level != null ? 'Lv ' + r.m.level : ''}</span>
          <small>${esc(subOf(r.m) ? subOf(r.m) + '・' : '')}${esc(where(r.m))}</small></span>
          <span class="rate">${r.rate != null ? r.rate + '%' : '?'}</span>${r === best ? `<span class="star">${t('best')}</span>` : ''}</div>`).join('')
        : `<p class="none">${rows.length ? t('noMatch') : essReach.checked ? t('noneInReach') : t('noData')}</p>`;
      return `<div class="tier" style="--tc:${tr.c}"><h4>${tierName(tr)}</h4>${body}</div>`;
    }).join('');
    const famIcon = DATA.items[`Dull ${f.key} Essence`];
    return `<article class="fam" style="--c:${f.c}">
      <div class="fam-head">${famIcon ? `<img class="sprite" src="${esc(famIcon)}" alt="" referrerpolicy="no-referrer">` : ''}<h3>${T[LANG].essence(f)}</h3>${zh() ? `<span class="region">${f.key} Essence</span>` : ''}</div>
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
applyLang();
fetch('data/site.json')
  .then((r) => r.json())
  .then((d) => {
    DATA = d;
    byName = new Map(d.monsters.map((m) => [m.name, m]));
    if (d.updated) document.querySelectorAll('.updated').forEach((el) => { el.textContent = d.updated; });
    renderFinder();
  })
  .catch(() => {
    results.innerHTML = `<div class="empty">${t('loadFail')}</div>`;
  });
