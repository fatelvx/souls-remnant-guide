// Builds data/site.json: monster stats from soulsremnant.gg (data/raw/monsters-gg.json, made by local/gg/extract.mjs)
// with official Traditional Chinese names. EXP is worked out in app.js.
// Run: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const names = read('./data/names-zh.json');
// Sprites are served from the wiki itself (File:<Page_Name>.png); the page falls back to a letter badge if one is missing.
const wikiImage = (name) => `https://soulsremnant.wiki.gg/images/${encodeURIComponent(name.replace(/ /g, '_'))}.png`;

// Regular monsters only: no bosses, no variants like "(Fleeing)", no dummies, no entries with unknown stats.
const mobs = read('./data/raw/monsters-gg.json')
  .filter((m) => !m.boss && m.hp > 0 && !m.name.includes('(') && !/Target Dummy/.test(m.name))
  .map((m) => ({ name: m.name, zh: names.monsters[m.name] || null, level: m.level, hp: m.hp, atk: m.atk, def: m.def, icon: wikiImage(m.name) }))
  .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

const out = { updated: new Date().toISOString().slice(0, 10), mobs };
writeFileSync(new URL('./data/site.json', import.meta.url), JSON.stringify(out));

// Stamp a new ?v= on the page's CSS/JS links so browsers never mix a cached page with new scripts.
const indexUrl = new URL('./index.html', import.meta.url);
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
writeFileSync(indexUrl, readFileSync(indexUrl, 'utf8').replace(/((?:href|src)="(?:style\.css|app\.js))(?:\?v=\w+)?"/g, `$1?v=${v}"`));
console.log(`monsters ${mobs.length}, without zh ${mobs.filter((m) => !m.zh).map((m) => m.name).join(', ') || 'none'}`);
