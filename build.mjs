// Merges the raw wiki scrapes in data/raw into data/site.json for the page.
// Run: node build.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const raw = (f) => JSON.parse(readFileSync(new URL(`./data/raw/${f}`, import.meta.url), 'utf8'));
const rawFiles = readdirSync(new URL('./data/raw/', import.meta.url));
const names = JSON.parse(readFileSync(new URL('./data/names-zh.json', import.meta.url), 'utf8'));
const notesZhFile = new URL('./data/notes-zh.json', import.meta.url);
const notesZh = existsSync(notesZhFile) ? JSON.parse(readFileSync(notesZhFile, 'utf8')) : {};

const FAMILIES = ['Life', 'Raging', 'Eternal', 'Ghostly', 'Metal', 'Historic', 'Nurturing'];
const ESS_RE = /^(Dull |Radiant )?(Life|Raging|Eternal|Ghostly|Metal|Historic|Nurturing) Essence$/i;

function parseEssence(item) {
  const m = String(item || '').trim().match(ESS_RE);
  if (!m) return null;
  const tier = m[1] ? m[1].trim().replace(/^./, (c) => c.toUpperCase()) : 'Normal';
  const fam = FAMILIES.find((f) => f.toLowerCase() === m[2].toLowerCase());
  return { tier, fam };
}

function parseRate(r) {
  if (r == null) return null;
  const n = parseFloat(String(r).replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

function parseLevel(v) {
  if (v == null || v === '' || v === 0 || v === '0') return null;
  if (typeof v === 'number') return { lo: v, hi: v };
  const m = String(v).match(/(\d+)\s*[-–~]\s*(\d+)/);
  if (m) return { lo: +m[1], hi: +m[2] };
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? { lo: n, hi: n } : null;
}

const iconExists = (p) => p && existsSync(new URL(`./${p}`, import.meta.url)) ? p : null;
// Sprites are served from the wiki itself (File:<Page_Name>.png); the page falls back to a letter badge if one is missing.
const wikiImage = (name) => `https://soulsremnant.wiki.gg/images/${encodeURIComponent(name.replace(/ /g, '_'))}.png`;
const clean = (s) => String(s || '').trim();

// Monsters
const monsters = new Map();
for (const f of rawFiles.filter((f) => /^monsters-\d+\.json$/.test(f))) {
  for (const m of raw(f)) {
    if (!m || !m.name || m.missing) continue;
    const name = clean(m.name);
    const lv = parseLevel(m.level);
    const drops = (m.drops || [])
      .map((d) => ({ item: clean(d.item), rate: parseRate(d.rate), ess: parseEssence(d.item) }))
      .filter((d) => d.item);
    monsters.set(name, {
      name,
      zh: names.monsters[name] || null,
      level: lv ? lv.lo : null,
      hp: m.hp ?? null,
      maps: (m.maps || []).map(clean).filter((x) => x && x !== 'Abyss Trial'),
      drops,
      boss: !!m.is_boss,
      icon: iconExists(m.icon) || wikiImage(name),
      url: m.url || null,
    });
  }
}

// Icons fetched in a later pass (icons-*.json: { "Monster Name": "assets/monsters/x.png" }).
for (const f of rawFiles.filter((f) => /^icons-\d+\.json$/.test(f))) {
  for (const [name, path] of Object.entries(raw(f))) {
    const mon = monsters.get(clean(name));
    if (mon && !mon.icon) mon.icon = iconExists(path);
  }
}

// Maps
const maps = new Map();
for (const f of rawFiles.filter((f) => /^maps-[a-z]\.json$/.test(f))) {
  for (const m of raw(f)) {
    if (!m || !m.name || m.missing) continue;
    const name = clean(m.name);
    maps.set(name, {
      name,
      region: clean(m.region) || null,
      level: parseLevel(m.level),
      monsters: (m.monsters || []).map(clean).filter(Boolean),
      essences: (m.essences || []).map(clean).filter(Boolean),
      gathering: (m.gathering || []).map(clean).filter(Boolean),
      notes: m.notes ? (notesZh[clean(m.notes)] || clean(m.notes)) : null,
      url: m.url || null,
    });
  }
}

// Map pages sometimes spell a monster differently ("ChronoShroom" vs "Chrono Shroom"); use the monster page's spelling.
const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const canonical = new Map([...monsters.keys(), ...Object.keys(names.monsters)].map((n) => [key(n), n]));
for (const mp of maps.values()) {
  mp.monsters = [...new Set(mp.monsters.map((n) => canonical.get(key(n)) || n))];
}

// Fill map monster lists from monster pages, and add maps only known from monster pages.
for (const mon of monsters.values()) {
  for (const mapName of mon.maps) {
    if (!maps.has(mapName)) {
      maps.set(mapName, { name: mapName, region: null, level: null, monsters: [], essences: [], gathering: [], notes: null, url: null });
    }
    const mp = maps.get(mapName);
    if (!mp.monsters.includes(mon.name)) mp.monsters.push(mon.name);
  }
}

// Monsters that only appear in map lists still get a sprite link and Chinese name.
for (const mp of maps.values()) {
  for (const n of mp.monsters) {
    if (!monsters.has(n)) monsters.set(n, { name: n, zh: names.monsters[n] || null, level: null, hp: null, maps: [mp.name], drops: [], boss: false, icon: wikiImage(n), url: null, stub: true });
    else if (monsters.get(n).stub && !monsters.get(n).maps.includes(mp.name)) monsters.get(n).maps.push(mp.name);
  }
}

// Maps without a listed level take the range of their monsters' levels.
for (const mp of maps.values()) {
  if (mp.level) continue;
  const lvs = mp.monsters.map((n) => monsters.get(n)?.level).filter((x) => x != null);
  if (lvs.length) mp.level = { lo: Math.min(...lvs), hi: Math.max(...lvs), derived: true };
}

const itemIcons = {};
for (const fam of FAMILIES) {
  for (const tier of ['Dull ', '', 'Radiant ']) itemIcons[`${tier}${fam} Essence`] = wikiImage(`${tier}${fam} Essence`);
}
itemIcons['Soul Crystal'] = wikiImage('Soul Crystal');
if (rawFiles.includes('item-icons.json')) {
  for (const it of raw('item-icons.json')) {
    if (it && it.name && iconExists(it.icon)) itemIcons[clean(it.name)] = it.icon;
  }
}

const out = {
  updated: new Date().toISOString().slice(0, 10),
  maps: [...maps.values()].filter((m) => m.monsters.length || m.level),
  monsters: [...monsters.values()],
  items: itemIcons,
  essenceNames: names.essences,
  zh: Object.fromEntries(Object.entries(names.monsters)),
};
writeFileSync(new URL('./data/site.json', import.meta.url), JSON.stringify(out));

// Stamp a new ?v= on the page's CSS/JS links so browsers never mix a cached page with new scripts.
const indexUrl = new URL('./index.html', import.meta.url);
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
writeFileSync(indexUrl, readFileSync(indexUrl, 'utf8').replace(/((?:href|src)="(?:style\.css|app\.js|exp\.js|ocr\.js))(?:\?v=\w+)?"/g, `$1?v=${v}"`));
console.log(`maps ${out.maps.length}, monsters ${out.monsters.length}, with icon ${out.monsters.filter((m) => m.icon).length}, item icons ${Object.keys(itemIcons).length}`);
