#!/usr/bin/env node
// Builds src/data/courses.json from course research files (one JSON array of courses per region)
// and per-nine hole notes.
//
//   node scripts/build-courses.mjs <research-dir> [out-file]
//
// Only pars that a course publishes itself are bundled. A nine is kept when it is marked
// confidence "high" and at least one of its sources is the course's own site (same host as its
// website, or a listed operator site). Commercial apps and crowd sites whose terms forbid reuse
// never count as a source, public data lists (data.go.kr) count only for the course list (they have
// no hole pars), and OpenStreetMap-derived fields (coordinates, English names matched from OSM) are
// not copied, so the bundle carries no ODbL obligations.
//
// Hole notes (lengths by tee, a short layout note, the hole's guide page, its stroke index) follow the
// same rule: a nine's notes are merged only when the page they were read from is on the course's own
// site, and a link only when it is an https page there. They come from hole-details*.json (one entry
// per nine) and from the hole fields of the official Gyeongsang research, whose nines cite only the
// course's own pages. Only the fields of HoleInfo in src/courses.ts are written.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const [dir, out = resolve(import.meta.dirname, '../src/data/courses.json')] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node scripts/build-courses.mjs <research-dir> [out-file]');
  process.exit(2);
}

/** Region files to read, in this order, when present. Other JSON files in the folder (OSM extracts) are ignored. */
const FILES = ['jeju-si', 'seogwipo-si', 'kr-gyeonggi', 'kr-gangwon', 'kr-chungcheong', 'kr-jeolla', 'kr-gyeongsang', 'kr-gyeongsang-official'];
/** Hole-note files (one entry per nine), read when present. A later entry replaces an earlier one for the same nine. */
const HOLE_FILES = ['hole-details', 'hole-details-2'];
/**
 * Region files whose nines also carry hole fields (distances, holeGuideUrls, si) read only from the course's own
 * pages. The other region files have such fields from the par research, whose sources were mixed: never used.
 */
const HOLE_FIELD_FILES = ['kr-gyeongsang-official'];
/** Hosts whose terms forbid reusing their data. A value backed only by these is never bundled. */
const DENIED = [/(^|\.)hole19golf\.com$/, /(^|\.)golfpass\.com$/, /(^|\.)18birdies\.com$/, /(^|\.)golfingrecord\.com$/, /(^|\.)golfzon\.com$/, /smartscore/, /kakao/,
  // GolfZon County is the operator's own site, but its terms (article 16) reserve copyright and forbid
  // redistribution without consent, so its values are not shipped.
  /(^|\.)golfzoncounty\.com$/];
/** Public lists and map data: fine for names and counts, never a source of hole pars. */
const NOT_PAR_SOURCES = [/(^|\.)data\.go\.kr$/, /(^|\.)openstreetmap\.org$/, /(^|\.)kgba\.co\.kr$/];
/** Operator sites that publish scorecards for courses whose own website lives elsewhere. */
const OPERATOR_HOSTS = ['shinangolf.com', 'dreamparkcc.or.kr'];
/** Area chips in the picker, from the first word of a region. */
const AREAS = [
  ['제주', ['제주']],
  ['수도권', ['경기', '서울', '인천']],
  ['강원', ['강원']],
  ['충청', ['충남', '충북', '대전', '세종']],
  ['전라', ['전남', '전북', '광주']],
  ['경상', ['경남', '경북', '부산', '대구', '울산']],
];

/** Tee keys in the hole research and the names the card shows, in the order lengths are listed after the first. */
const TEES = new Map([
  ['champion', '챔피언'], ['back', '백'], ['black', '블랙'], ['blue', '블루'], ['white', '화이트'], ['white1', '화이트1'], ['white2', '화이트2'],
  ['regular', '레귤러'], ['front', '프런트'], ['gold', '골드'], ['senior', '시니어'], ['yellow', '옐로'], ['orange', '오렌지'], ['pink', '핑크'],
  ['lady', '레이디'], ['red', '레드'], ['red2', '레드2'],
]);
/**
 * A tee key may end in the green it plays to, on courses with two greens per hole: "regular_a", "white_l",
 * "blue_left". Courses print these as A/B, L/R or 좌/우 next to the lengths.
 */
const GREENS = new Map([['a', 'A그린'], ['l', '좌그린'], ['b', 'B그린'], ['r', '우그린']]);
/** The tee most players start from is listed first, because the card shows the first length. */
const FIRST_TEES = ['white', 'white1', 'regular', 'blue', 'front'];
/** Tee names as the Gyeongsang research writes them (lower case, without "Tee" or a green) → tee keys. */
const TEE_NAMES = new Map([
  ['black', 'black'], ['blue', 'blue'], ['white', 'white'], ['white1', 'white1'], ['white2', 'white2'], ['red', 'red'], ['gold', 'gold'],
  ['yellow', 'yellow'], ['pink', 'pink'], ['lady', 'lady'], ['ladies', 'lady'], ['regular', 'regular'], ['reg', 'regular'], ['r/t', 'regular'],
  ['back', 'back'], ['b', 'back'], ['front', 'front'], ['f', 'front'], ['champ', 'champion'], ['champion', 'champion'], ['c/t', 'champion'],
]);
/**
 * Research notes on a Gyeongsang nine that do not question its lengths: differences from earlier crowd-sourced
 * values (the official value is the one recorded), handicap notes (checked on their own), course names and par
 * totals. Any other note (holes that do not add up to the page's total, tees out of order, m and yd that do not
 * convert, pages that disagree) leaves out every length of that nine.
 */
const HARMLESS_NOTE = /^이전 크라우드|HDCP|코스 이름|파 합계/;
/**
 * Courses whose lengths have no clear unit on their own pages, left out rather than guessed. Cypress: its spec
 * table says m, its hole guide labels the same numbers yd. Ansung: its score card prints no unit, and yards are
 * only inferred from a course total on another page.
 */
const UNCLEAR_UNITS = ['cypress', 'ansung'];
/** Lengths in metres a hole of each par can have. Anything else is taken as misread and left out. */
const PAR_RANGE_M = { 3: [60, 280], 4: [180, 560], 5: [300, 650] };
const M_PER_YD = 0.9144;
/** A layout note is at most three short phrases joined by ", ", within the 40 characters holeInfo() keeps. */
const MAX_PHRASES = 3;
const MAX_PHRASE = 20;
const MAX_LAYOUT = 40;

const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const isHttps = (url) => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

/** "제주시 애월읍" → "제주 제주시", "경기 용인시 처인구" → "경기 용인시". */
function regionLabel(region, jeju) {
  const words = region.replace(/\(.*?\)/g, ' ').trim().split(/\s+/);
  return jeju ? `제주 ${words[0]}` : words.slice(0, 2).join(' ');
}

function area(region) {
  const first = region.split(' ')[0];
  const found = AREAS.find(([, prefixes]) => prefixes.includes(first));
  if (!found) throw new Error(`unknown region "${region}"`);
  return found[0];
}

const report = {
  courses: {},
  nines: {},
  excluded: { notHigh: 0, noOfficialSource: 0, badPars: [] },
  holes: {
    byArea: {},
    checked: [],
    notCollected: [],
    excluded: { noOfficialSource: [], badHoles: [] },
    leftOut: {
      unclearUnit: 0, noUnit: [], lengthConflict: [], placeholder: [], badLength: [], unknownTee: [], singleBesideTees: 0,
      unclearSi: [], httpLink: 0, notOfficialLink: 0, phraseTooLong: 0, noteShortened: 0,
    },
  },
  warnings: [],
};

function readList(file) {
  try {
    return JSON.parse(readFileSync(join(dir, `${file}.json`), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    report.warnings.push(`${file}.json not found, skipped`);
    return null;
  }
}

/** "Blue (L 그린)" → blue_l, "B.Tee" → back, "(티 표기 없음, m)" → a length with no tee name (in m); null for numbered or icon-only tees. */
function teeKey(name) {
  const single = /^\(티 표기 없음(?:, (m|yd))?\)$|^Hole_Length\(최장 티\)$/.exec(name);
  if (single) return { key: 'length', unit: single[1] };
  const green = /\((?:L|왼쪽) ?그린\)/.test(name) ? '_l' : /\((?:R|오른쪽) ?그린\)/.test(name) ? '_r' : '';
  const base = name.replace(/\((?:L|R|왼쪽|오른쪽) ?그린\)/, '').trim().toLowerCase().replace(/^white\s*\((\d)\)$/, 'white$1').replace(/[ .]tee$/, '');
  const key = TEE_NAMES.get(base);
  return key ? { key: key + green } : null;
}

/** The hole fields a region file carries on a nine, in the hole-details shape; null when there is nothing to use. */
function regionHoleNotes(c, n, source) {
  const key = `${c.id}/${n.id}`;
  const urls = Array.isArray(n.holeGuideUrls) ? n.holeGuideUrls : [];
  const si = Array.isArray(n.si) ? n.si : [];
  const tees = Object.entries(n.distances?.tees ?? {});
  const notes = Array.isArray(n.conflicts) ? n.conflicts : typeof n.conflicts === 'string' ? [n.conflicts] : [];
  const doubtful = notes.some((note) => typeof note !== 'string' || !HARMLESS_NOTE.test(note));
  if (doubtful && tees.length) report.holes.leftOut.lengthConflict.push(key);
  const raw = Array.from({ length: 9 }, () => ({}));
  const used = new Set();
  for (const [name, values] of doubtful ? [] : tees) {
    const tee = teeKey(name);
    const unit = tee?.unit ?? n.distances?.unit;
    if (!tee || used.has(`${tee.key}_${unit}`)) {
      report.holes.leftOut.unknownTee.push(`${key} ${name}`);
      continue;
    }
    if (unit !== 'm' && unit !== 'yd') {
      if (!report.holes.leftOut.noUnit.includes(key)) report.holes.leftOut.noUnit.push(key);
      continue;
    }
    used.add(`${tee.key}_${unit}`);
    for (let i = 0; i < 9; i += 1) raw[i][`${tee.key}_${unit}`] = values?.[i] ?? null;
  }
  if (!used.size && !urls.some(Boolean) && !si.some((v) => v !== null)) return null;
  return {
    courseId: c.id,
    nineId: String(n.id),
    source: source.url,
    checked: source.checked,
    holes: raw.map((distances, i) => ({ n: i + 1, guideUrl: urls[i] ?? null, si: si[i] ?? null, layout: null, distances })),
  };
}

const courses = [];
const ids = new Set();
/** Bundled course id → whether a URL is on that course's own site (or its operator's). */
const officialFor = new Map();
/** Hole notes by "course/nine": region files first, then the hole-details files. */
const holeNotes = new Map();

for (const file of FILES) {
  const list = readList(file);
  if (!list) continue;
  const jeju = file === 'jeju-si' || file === 'seogwipo-si';
  for (const c of list) {
    const website = host(c.website ?? '');
    const officialUrl = (url) => {
      const h = host(url ?? '');
      if (!h || DENIED.some((re) => re.test(h)) || NOT_PAR_SOURCES.some((re) => re.test(h))) return false;
      return h === website || OPERATOR_HOSTS.includes(h);
    };
    const nines = [];
    for (const n of c.nines ?? []) {
      if (n.confidence !== 'high') {
        report.excluded.notHigh += 1;
        continue;
      }
      const source = (n.sources ?? []).find((s) => officialUrl(s.url));
      if (!source) {
        report.excluded.noOfficialSource += 1;
        continue;
      }
      if (!Array.isArray(n.par) || n.par.length !== 9 || !n.par.every((p) => p === 3 || p === 4 || p === 5)) {
        report.excluded.badPars.push(`${c.id}/${n.id}: ${JSON.stringify(n.par)}`);
        continue;
      }
      const sum = n.par.reduce((a, b) => a + b, 0);
      if (sum < 33 || sum > 38) report.warnings.push(`${c.id}/${n.id}: par ${sum}`);
      const ownPages = HOLE_FIELD_FILES.includes(file) && (n.sources ?? []).every((s) => officialUrl(s.url));
      nines.push({ nine: { id: String(n.id), name: { ko: n.name.ko, en: null }, par: n.par }, source, notes: ownPages ? regionHoleNotes(c, n, source) : null });
    }
    if (!nines.length) continue;
    if (ids.has(c.id)) throw new Error(`duplicate course id ${c.id}`);
    ids.add(c.id);
    officialFor.set(c.id, officialUrl);
    if (new Set(nines.map((x) => x.nine.id)).size !== nines.length) throw new Error(`duplicate nine id in ${c.id}`);
    for (const x of nines) if (x.notes) holeNotes.set(`${c.id}/${x.nine.id}`, x.notes);
    const region = regionLabel(c.region, jeju);
    const a = area(region);
    courses.push({
      id: c.id,
      // English names in the research were partly matched from OpenStreetMap; only Korean names are kept (nines too).
      name: { ko: c.name.ko, en: null },
      area: a,
      region,
      // The scorecard page the pars come from, and when it was last checked.
      source: nines[0].source.url,
      checked: nines.map((x) => x.source.checked).filter(Boolean).sort().at(-1) ?? null,
      nines: nines.map((x) => x.nine),
    });
    report.courses[a] = (report.courses[a] ?? 0) + 1;
    report.nines[a] = (report.nines[a] ?? 0) + nines.length;
  }
}

const everis = courses.find((c) => c.id === 'everis');
if (!everis || ['saebyul', 'lake', 'pine'].some((id) => !everis.nines.some((n) => n.id === id))) {
  throw new Error('Everis with 새별, 레이크 and 파인 must be in the bundle');
}

const isDogleg = (phrase) => phrase.includes('도그');

/** Up to three of the research's short phrases within 40 characters, in their order; a dogleg phrase is kept first. */
function layoutNote(phrases) {
  if (!Array.isArray(phrases)) return '';
  const clean = [...new Set(phrases.filter((p) => typeof p === 'string').map((p) => p.trim()).filter(Boolean))];
  const short = clean.filter((p) => p.length <= MAX_PHRASE && !p.includes(','));
  report.holes.leftOut.phraseTooLong += clean.length - short.length;
  const kept = [];
  for (const p of [...short.filter(isDogleg), ...short.filter((p) => !isDogleg(p))]) {
    if (kept.length < MAX_PHRASES && [...kept, p].join(', ').length <= MAX_LAYOUT) kept.push(p);
  }
  if (kept.length < short.length) report.holes.leftOut.noteShortened += 1;
  return short.filter((p) => kept.includes(p)).join(', ');
}

const hasLengths = (h) => Object.values(h?.distances ?? {}).some((v) => v !== null);
const hasNotes = (h) => hasLengths(h) || (Array.isArray(h?.layout) && h.layout.length > 0) || typeof h?.guideUrl === 'string' || Number.isInteger(h?.si);

/**
 * "regular_a" → { base: "regular", green: "a" }, "blue_left" → green "l", "tee71" → a tee the course names only by
 * its number (71); null for a key that names no known tee.
 */
function teeParts(key) {
  const m = /^([a-z]+\d*)(?:_(a|b|l|r|left|right))?$/.exec(key ?? '');
  if (!m) return null;
  const green = { left: 'l', right: 'r' }[m[2]] ?? m[2] ?? '';
  if (TEES.has(m[1])) return { base: m[1], green, number: 0 };
  const number = /^tee(\d{2})$/.exec(m[1]);
  return number ? { base: m[1], green, number: Number(number[1]) } : null;
}
function teeLabel({ base, green, number }) {
  const name = number ? `${number}티` : TEES.get(base);
  return green ? `${name} ${GREENS.get(green)}` : name;
}
/** TEES order, numbered tees after the named ones from the highest number down, the A or L green before B or R. */
const teeRank = ({ base, green, number }) =>
  (number ? TEES.size + 100 - number : [...TEES.keys()].indexOf(base)) * 10 + (green ? [...GREENS.keys()].indexOf(green) + 1 : 0);

/**
 * One length per named tee, the starting tee first (both its greens on a two-green hole), then the others in TEES
 * order; metres when a tee has both units.
 * A single length with no tee name is kept only when no tee is named. An unknown tee or a length that does not
 * fit the par is left out, and so is every length of a hole whose tees all show the same one (a placeholder).
 */
function teeLengths(raw, par, where) {
  const named = new Map();
  let single = null;
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (value === null) continue;
    const [, tee, unit] = /^(.+)_(m|yd)$/.exec(key) ?? [];
    const parts = tee === 'length' ? null : teeParts(tee);
    if (tee !== 'length' && !parts) {
      report.holes.leftOut.unknownTee.push(`${where} ${key}`);
      continue;
    }
    const [low, high] = PAR_RANGE_M[par];
    const metres = unit === 'yd' ? value * M_PER_YD : value;
    if (typeof value !== 'number' || !(metres >= low && metres <= high)) {
      report.holes.leftOut.badLength.push(`${where} ${key}=${value}`);
      continue;
    }
    if (!parts) {
      if (unit === 'm' || !single) single = { length: value, unit };
    } else if (unit === 'm' || !named.has(tee)) {
      named.set(tee, { parts, length: { tee: teeLabel(parts), length: value, unit } });
    }
  }
  if (!named.size) return single ? [single] : [];
  if (single) report.holes.leftOut.singleBesideTees += 1;
  const lengths = [...named.values()].map((x) => x.length);
  if (lengths.length > 1 && lengths.every((d) => d.length === lengths[0].length && d.unit === lengths[0].unit)) {
    report.holes.leftOut.placeholder.push(where);
    return [];
  }
  const sorted = [...named.values()].sort((a, b) => teeRank(a.parts) - teeRank(b.parts));
  const firstBase = FIRST_TEES.find((t) => sorted.some((x) => x.parts.base === t));
  const starting = (x) => x.parts.base === firstBase;
  return [...sorted.filter(starting), ...sorted.filter((x) => !starting(x))].map((x) => x.length);
}

const isRun = (values, n) => values.length === n && new Set(values).size === n && values.every((v) => Number.isInteger(v) && v >= 1 && v <= n);

/**
 * A course's stroke indexes as published, nine by nine, where they make sense: 1–9 once each within the nine, or
 * 1–18 once each across the nine and another of the course. A nine with a duplicate, a gap or a missing hole gets
 * none.
 */
function strokeIndexes(courseId, byNine) {
  const usable = new Map();
  const full = [...byNine].filter(([, si]) => si.every((v) => Number.isInteger(v)));
  for (const [id, si] of full) {
    const ok = Math.max(...si) <= 9 ? isRun(si, 9) : new Set(si).size === 9 && full.some(([other, o]) => other !== id && isRun([...si, ...o], 18));
    if (ok) usable.set(id, si);
  }
  for (const [id, si] of byNine) if (!usable.has(id) && si.some((v) => v !== null)) report.holes.leftOut.unclearSi.push(`${courseId}/${id}`);
  return usable;
}

for (const file of HOLE_FILES) {
  for (const entry of readList(file) ?? []) {
    const key = `${entry.courseId}/${entry.nineId}`;
    if (holeNotes.has(key)) report.warnings.push(`${key}: ${file}.json replaces an earlier hole entry`);
    holeNotes.set(key, entry);
  }
}

for (const course of courses) {
  const officialUrl = officialFor.get(course.id);
  const unclearUnit = UNCLEAR_UNITS.includes(course.id);
  const entries = new Map();
  for (const nine of course.nines) {
    const key = `${course.id}/${nine.id}`;
    const entry = holeNotes.get(key);
    if (!entry) continue;
    holeNotes.delete(key);
    if (!(entry.holes ?? []).some(hasNotes)) {
      report.holes.notCollected.push(key);
      continue;
    }
    if (!officialUrl(entry.source)) {
      report.holes.excluded.noOfficialSource.push(key);
      continue;
    }
    if (!Array.isArray(entry.holes) || entry.holes.length !== 9 || entry.holes.some((h, i) => h?.n !== i + 1)) {
      report.holes.excluded.badHoles.push(key);
      continue;
    }
    entries.set(nine.id, entry);
  }
  const strokes = strokeIndexes(course.id, new Map([...entries].map(([id, e]) => [id, e.holes.map((h) => (Number.isInteger(h.si) ? h.si : null))])));
  for (const nine of course.nines) {
    const entry = entries.get(nine.id);
    if (!entry) continue;
    const key = `${course.id}/${nine.id}`;
    const holes = entry.holes.map((h, i) => {
      const note = {};
      if (unclearUnit && hasLengths(h)) report.holes.leftOut.unclearUnit += 1;
      const distances = unclearUnit ? [] : teeLengths(h.distances, nine.par[i], `${key}#${i + 1}`);
      if (distances.length) note.distances = distances;
      const layout = layoutNote(h.layout);
      if (layout) note.layout = layout;
      if (typeof h.guideUrl === 'string') {
        if (!isHttps(h.guideUrl)) report.holes.leftOut.httpLink += 1;
        else if (!officialUrl(h.guideUrl)) report.holes.leftOut.notOfficialLink += 1;
        else note.guideUrl = h.guideUrl;
      }
      if (strokes.has(nine.id)) note.si = strokes.get(nine.id)[i];
      return Object.keys(note).length ? note : null;
    });
    if (!holes.some(Boolean)) continue;
    nine.holes = holes;
    if (entry.checked) report.holes.checked.push(entry.checked);
  }
}
for (const key of holeNotes.keys()) report.warnings.push(`${key}: hole notes for a nine that is not bundled, skipped`);

const order = AREAS.map(([name]) => name);
courses.sort((x, y) => order.indexOf(x.area) - order.indexOf(y.area) || x.name.ko.localeCompare(y.name.ko, 'ko'));

for (const c of courses) {
  const noted = c.nines.filter((n) => n.holes);
  if (!noted.length) continue;
  const a = (report.holes.byArea[c.area] ??= { courses: 0, nines: 0, holes: 0, distances: 0, layout: 0, guideUrl: 0, si: 0 });
  a.courses += 1;
  a.nines += noted.length;
  for (const h of noted.flatMap((n) => n.holes)) {
    if (!h) continue;
    a.holes += 1;
    if (h.distances) a.distances += 1;
    if (h.layout) a.layout += 1;
    if (h.guideUrl) a.guideUrl += 1;
    if (h.si !== undefined) a.si += 1;
  }
}
report.holes.checked = [...new Set(report.holes.checked)].sort();

writeFileSync(out, `${JSON.stringify({ version: 1, courses })}\n`);
console.log(`wrote ${courses.length} courses to ${basename(out)}`);
console.log(JSON.stringify(report, null, 2));
