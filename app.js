// Language switch and the monster EXP table, rendered from data/site.json.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
const fmt = (n) => n.toLocaleString('en-US');

/* ---------- EXP rule (guild tests, see data/exp/README.md) ---------- */
const BASE_LV = 31, BASE_EXP = 866, TESTED_MAX = 69;
const baseTable = [BASE_EXP];
for (let lv = BASE_LV + 1; lv <= 200; lv++) baseTable.push(Math.round(baseTable.at(-1) * (lv <= 50 ? 1.1 : 1.095)));
// EXP = round(X) + floor(X * other bonuses), X = base * (1 + bestiary)
function killExp(lv, bestiary, bonusPct) {
  if (lv < BASE_LV || lv - BASE_LV >= baseTable.length) return null;
  const x = baseTable[lv - BASE_LV] * (bestiary ? 1.05 : 1);
  return Math.round(x) + Math.floor(x * bonusPct / 100 + 1e-9);
}

let DATA = null;

/* ---------- Language ---------- */
// Static text is written twice in index.html (data-l="zh" / data-l="en") and CSS hides the other one;
// everything rendered here goes through T.
const T = {
  zh: {
    title: "Soul's Remnant 怪物經驗表", desc: "Soul's Remnant 怪物等級、HP、攻防與每隻經驗。",
    mon: '怪物', lv: '等級', hp: 'HP', atk: '攻擊', def: '防禦', exp: '經驗', none: '—', empty: '找不到符合的怪物。',
    loadFail: '資料載入失敗，請重新整理頁面。',
  },
  en: {
    title: "Soul's Remnant Monster EXP", desc: "Soul's Remnant monster levels, HP, attack, defense and EXP per kill.",
    mon: 'Monster', lv: 'Level', hp: 'HP', atk: 'ATK', def: 'DEF', exp: 'EXP', none: '—', empty: 'No monsters match.',
    loadFail: 'Could not load the data. Please refresh the page.',
  },
};
const fromUrl = new URLSearchParams(location.search).get('lang');
let LANG = fromUrl || store.get('lang') || (/^zh/i.test(navigator.language) ? 'zh' : 'en');
if (LANG !== 'en') LANG = 'zh';
const t = (k) => T[LANG][k];
const zh = () => LANG === 'zh';

function applyLang() {
  document.documentElement.lang = zh() ? 'zh-Hant' : 'en';
  document.title = t('title');
  document.querySelector('meta[name="description"]').content = t('desc');
  document.querySelectorAll('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === LANG)));
  render();
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

/* ---------- Table ---------- */
const q = document.getElementById('q');
const bonus = document.getElementById('bonus');
const bestiary = document.getElementById('bestiary');
const table = document.getElementById('mob-table');
const saved = store.get('bonus');
if (saved) bonus.value = saved;
bestiary.checked = store.get('bestiary') === '1';
q.addEventListener('input', render);
bonus.addEventListener('input', render);
bestiary.addEventListener('change', render);

function render() {
  if (!DATA) return;
  const b = Math.max(0, parseFloat(bonus.value) || 0);
  store.set('bonus', bonus.value);
  store.set('bestiary', bestiary.checked ? '1' : '0');
  const term = q.value.trim().toLowerCase();
  const rows = DATA.mobs
    .filter((m) => !term || m.name.toLowerCase().includes(term) || (m.zh || '').includes(term))
    .map((m) => {
      const e = killExp(m.level, bestiary.checked, b);
      const name = zh() ? m.zh || m.name : m.name;
      const exp = e == null ? `<span class="muted">${t('none')}</span>` : `<b class="${m.level > TESTED_MAX ? 'calc' : ''}">${fmt(e)}</b>`;
      return `<tr><td class="mon"><img src="${esc(m.icon)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'badge',textContent:this.dataset.c}))" data-c="${esc(name[0])}">${esc(name)}</td>
        <td class="lv">${m.level}</td><td class="num exp">${exp}</td><td class="num">${fmt(m.hp)}</td><td class="num">${fmt(m.atk)}</td><td class="num">${fmt(m.def)}</td></tr>`;
    }).join('');
  table.innerHTML = `<thead><tr><th>${t('mon')}</th><th>${t('lv')}</th><th>${t('exp')}</th><th>${t('hp')}</th><th>${t('atk')}</th><th>${t('def')}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="muted">${t('empty')}</td></tr>`}</tbody>`;
}

/* ---------- Load ---------- */
applyLang();
fetch('data/site.json')
  .then((r) => r.json())
  .then((d) => {
    DATA = d;
    if (d.updated) document.querySelectorAll('.updated').forEach((el) => { el.textContent = d.updated; });
    render();
  })
  .catch(() => {
    table.innerHTML = `<tbody><tr><td class="muted">${t('loadFail')}</td></tr></tbody>`;
  });
