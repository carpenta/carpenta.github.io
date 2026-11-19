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
// Hole notes (lengths by tee, a short layout note, the hole's guide page) follow the same rule: a
// nine's notes are merged only when the page they were read from is on the course's own site, and a
// link only when it is an https page there. Only the fields of HoleInfo in src/courses.ts are
// written; the stroke indexes in the research are not bundled.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const [dir, out = resolve(import.meta.dirname, '../src/data/courses.json')] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node scripts/build-courses.mjs <research-dir> [out-file]');
  process.exit(2);
}

/** Region files to read, in this order, when present. Other JSON files in the folder (OSM extracts) are ignored. */
const FILES = ['jeju-si', 'seogwipo-si', 'kr-gyeonggi', 'kr-gangwon', 'kr-chungcheong', 'kr-jeolla', 'kr-gyeongsang', 'kr-gyeongsang-official'];
/** Hole-note files (one entry per nine), read when present. A later file's entry replaces an earlier one for the same nine. */
const HOLE_FILES = ['hole-details', 'hole-details-2'];
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

/** Tee keys in the hole research and the names the card shows, longest tees first. */
const TEES = new Map([
  ['champion_a', '챔피언 A그린'], ['champion_b', '챔피언 B그린'], ['back', '백'], ['black', '블랙'], ['blue', '블루'],
  ['white', '화이트'], ['regular', '레귤러'], ['regular_a', '레귤러 A그린'], ['regular_b', '레귤러 B그린'],
  ['gold', '골드'], ['yellow', '옐로'], ['lady', '레이디'], ['red', '레드'], ['red2', '레드2'],
]);
/** The tee most players start from is listed first: the card shows the first length. */
const FIRST_TEES = ['white', 'regular', 'regular_a'];
/**
 * Courses whose own pages give the same lengths in two units (Cypress: its spec table says m, its hole
 * guide labels the same numbers yd). Their lengths are left out rather than guessed.
 */
const UNCLEAR_UNITS = ['cypress'];
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
    leftOut: { unclearUnit: 0, noTeeName: 0, placeholder: [], badLength: [], unknownTee: [], httpLink: 0, notOfficialLink: 0, phraseTooLong: 0, noteShortened: 0 },
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

const courses = [];
const ids = new Set();
/** Bundled course id → whether a URL is on that course's own site (or its operator's). */
const officialFor = new Map();

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
      nines.push({ nine: { id: String(n.id), name: { ko: n.name.ko, en: null }, par: n.par }, source });
    }
    if (!nines.length) continue;
    if (ids.has(c.id)) throw new Error(`duplicate course id ${c.id}`);
    ids.add(c.id);
    officialFor.set(c.id, officialUrl);
    if (new Set(nines.map((x) => x.nine.id)).size !== nines.length) throw new Error(`duplicate nine id in ${c.id}`);
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
const hasNotes = (h) => hasLengths(h) || (Array.isArray(h?.layout) && h.layout.length > 0) || typeof h?.guideUrl === 'string';

/**
 * One length per named tee, the starting tee first, then longest to shortest. Metres are kept when a tee has
 * both units. A length with no tee name, an unknown tee or a length that does not fit the par is left out, and
 * so is every length of a hole whose tees all show the same one (a placeholder).
 */
function teeLengths(raw, par, where) {
  const byTee = new Map();
  let noTee = false;
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (value === null) continue;
    const [, tee, unit] = /^(.+)_(m|yd)$/.exec(key) ?? [];
    if (tee === 'length') {
      noTee = true;
      continue;
    }
    if (!TEES.has(tee)) {
      report.holes.leftOut.unknownTee.push(`${where} ${key}`);
      continue;
    }
    const [low, high] = PAR_RANGE_M[par];
    const metres = unit === 'yd' ? value * M_PER_YD : value;
    if (typeof value !== 'number' || !(metres >= low && metres <= high)) {
      report.holes.leftOut.badLength.push(`${where} ${key}=${value}`);
      continue;
    }
    if (unit === 'm' || !byTee.has(tee)) byTee.set(tee, { tee: TEES.get(tee), length: value, unit });
  }
  if (noTee) report.holes.leftOut.noTeeName += 1;
  const lengths = [...byTee.values()];
  if (lengths.length > 1 && lengths.every((d) => d.length === lengths[0].length && d.unit === lengths[0].unit)) {
    report.holes.leftOut.placeholder.push(where);
    return [];
  }
  const first = FIRST_TEES.find((t) => byTee.has(t));
  const order = [...TEES.keys()];
  return [...byTee.keys()]
    .sort((a, b) => Number(b === first) - Number(a === first) || order.indexOf(a) - order.indexOf(b))
    .map((t) => byTee.get(t));
}

const holeNotes = new Map();
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
  const a = (report.holes.byArea[c.area] ??= { courses: 0, nines: 0, holes: 0, distances: 0, layout: 0, guideUrl: 0 });
  a.courses += 1;
  a.nines += noted.length;
  for (const h of noted.flatMap((n) => n.holes)) {
    if (!h) continue;
    a.holes += 1;
    if (h.distances) a.distances += 1;
    if (h.layout) a.layout += 1;
    if (h.guideUrl) a.guideUrl += 1;
  }
}
report.holes.checked = [...new Set(report.holes.checked)].sort();

writeFileSync(out, `${JSON.stringify({ version: 1, courses })}\n`);
console.log(`wrote ${courses.length} courses to ${basename(out)}`);
console.log(JSON.stringify(report, null, 2));
