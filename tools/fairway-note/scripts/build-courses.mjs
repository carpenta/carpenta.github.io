#!/usr/bin/env node
// Builds src/data/courses.json from course research files (one JSON array of courses per region).
//
//   node scripts/build-courses.mjs <research-dir> [out-file]
//
// Only pars that a course publishes itself are bundled. A nine is kept when it is marked
// confidence "high" and at least one of its sources is the course's own site (same host as its
// website, or a listed operator site). Commercial apps and crowd sites whose terms forbid reuse
// never count as a source, public data lists (data.go.kr) count only for the course list (they have
// no hole pars), and OpenStreetMap-derived fields (coordinates, English names matched from OSM) are
// not copied, so the bundle carries no ODbL obligations.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const [dir, out = resolve(import.meta.dirname, '../src/data/courses.json')] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node scripts/build-courses.mjs <research-dir> [out-file]');
  process.exit(2);
}

/** Region files to read, in this order. Other JSON files in the folder (OSM extracts) are ignored. */
const FILES = ['jeju-si', 'seogwipo-si', 'kr-gyeonggi', 'kr-gangwon', 'kr-chungcheong', 'kr-jeolla', 'kr-gyeongsang'];
/** Hosts whose terms forbid reusing their data. A value backed only by these is never bundled. */
const DENIED = [/(^|\.)hole19golf\.com$/, /(^|\.)golfpass\.com$/, /(^|\.)18birdies\.com$/, /(^|\.)golfingrecord\.com$/, /(^|\.)golfzon\.com$/, /smartscore/, /kakao/];
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

const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
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

const report = { courses: {}, nines: {}, excluded: { notHigh: 0, noOfficialSource: 0, badPars: [] }, warnings: [] };
const courses = [];
const ids = new Set();

for (const file of FILES) {
  let list;
  try {
    list = JSON.parse(readFileSync(join(dir, `${file}.json`), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      report.warnings.push(`${file}.json not found, skipped`);
      continue;
    }
    throw error;
  }
  const jeju = file === 'jeju-si' || file === 'seogwipo-si';
  for (const c of list) {
    const website = host(c.website ?? '');
    const official = (s) => {
      const h = host(s.url);
      if (!h || DENIED.some((re) => re.test(h)) || NOT_PAR_SOURCES.some((re) => re.test(h))) return false;
      return h === website || OPERATOR_HOSTS.includes(h);
    };
    const nines = [];
    for (const n of c.nines ?? []) {
      if (n.confidence !== 'high') {
        report.excluded.notHigh += 1;
        continue;
      }
      const source = (n.sources ?? []).find(official);
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

const order = AREAS.map(([name]) => name);
courses.sort((x, y) => order.indexOf(x.area) - order.indexOf(y.area) || x.name.ko.localeCompare(y.name.ko, 'ko'));

writeFileSync(out, `${JSON.stringify({ version: 1, courses })}\n`);
console.log(`wrote ${courses.length} courses to ${basename(out)}`);
console.log(JSON.stringify(report, null, 2));
