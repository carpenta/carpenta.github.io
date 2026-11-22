// Builds src/data/osm/everis.json, the Everis holes drawn from OpenStreetMap (v27), from an Overpass extract and the
// hand-made hole mapping in src/data/osm/everis-holes.json. Run by hand, never in the build or CI:
//
//   bun run osm:holes <overpass extract.json>
//
// The query and its date are in src/data/osm/README.md. The output is a Derivative Database of OpenStreetMap under ODbL 1.0
// (© OpenStreetMap contributors): it stays in src/data/osm/, apart from the official course data in src/data/courses.json.
// For each mapped hole it keeps, in metres east and north of the hole's green centre (one decimal): the line of play from
// the back tee to the green, simplified outlines of its greens, tees, fairways, bunkers and the water near it, and the OSM
// element ids used. It prints each hole's measured length beside the official one, for the evidence in the mapping.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inRing, lineLength, playLine, projector, ringArea, ringCentroid, segmentDistance, simplifyRing } from '../src/osm-geo.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAPPING = join(root, 'src/data/osm/everis-holes.json');
const OUT = join(root, 'src/data/osm/everis.json');

/** Simplification tolerances in metres: small shapes finer, water coarser. */
const TOL = { tee: 0.6, green: 0.4, bunker: 0.5, fairway: 0.8, water: 1 };
/** A bunker belongs to a hole inside its rough or this close to its green or fairway; water this close to its play. */
const BUNKER_NEAR = 12;
const WATER_NEAR = 25;

const [input] = process.argv.slice(2);
if (!input) {
  console.error('usage: bun run osm:holes <overpass extract.json>');
  process.exit(1);
}
const extract = JSON.parse(readFileSync(input, 'utf8'));
const mapping = JSON.parse(readFileSync(MAPPING, 'utf8'));
const byKey = new Map(extract.elements.map((e) => [`${e.type[0]}${e.id}`, e]));

// One projection for the whole course, centred on its boundary's bounding box.
const boundary = byKey.get(mapping.boundary);
if (!boundary?.geometry) throw new Error(`the extract has no geometry for the course boundary ${mapping.boundary}`);
const lats = boundary.geometry.map((p) => p.lat);
const lons = boundary.geometry.map((p) => p.lon);
const project = projector((Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2);
const xy = (p) => project(p.lat, p.lon);
const open = (ring) => (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring);

/** An element's rings in course metres: a closed way's one ring, or a multipolygon's outer ring then its inner ones. */
function ringsOf(e) {
  if (e.type === 'way') return [open(e.geometry.map(xy))];
  const outer = e.members.filter((m) => m.role === 'outer' && m.geometry);
  const inner = e.members.filter((m) => m.role === 'inner' && m.geometry);
  if (outer.length !== 1) throw new Error(`relation ${e.id}: expected one closed outer ring, found ${outer.length}`);
  return [...outer, ...inner].map((m) => open(m.geometry.map(xy)));
}

const all = [...byKey.entries()].filter(([, e]) => e.type !== 'node' && e.tags);
const withTag = (key, value) => all.filter(([, e]) => e.tags[key] === value).map(([k, e]) => ({ key: k, rings: ringsOf(e) }));
const roughs = withTag('golf', 'rough');
const bunkers = withTag('golf', 'bunker');
// Water hazards, and natural water not already tagged as one (most carry both tags).
const water = [...withTag('golf', 'water_hazard'), ...all.filter(([, e]) => e.tags.natural === 'water' && e.tags.golf !== 'water_hazard').map(([k, e]) => ({ key: k, rings: ringsOf(e) }))];

/** How far p lies from a ring: 0 inside it. */
const ringDistance = (p, ring) => (inRing(p, ring) ? 0 : Math.min(...ring.map((a, i) => segmentDistance(p, a, ring[(i + 1) % ring.length]))));
/** How close two rings come: 0 where they overlap (checked at their points). */
const ringsApart = (a, b) => Math.min(...a.map((p) => ringDistance(p, b)), ...b.map((p) => ringDistance(p, a)));

const round = (n) => Math.round(n * 10) / 10 || 0;
const flat = (ring, [ox, oy], tol) => simplifyRing(ring, tol).flatMap(([x, y]) => [round(x - ox), round(y - oy)]);

const official = JSON.parse(readFileSync(join(root, 'src/data/courses.json'), 'utf8')).courses.find((c) => c.id === mapping.course);
const out = { course: mapping.course, osmBase: extract.osm3s.timestamp_osm_base, licence: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', holes: {} };
for (const nine of official.nines) out.holes[nine.id] = Array(nine.par.length).fill(null);

for (const h of mapping.holes) {
  if (!h.tees) continue; // left on the schematic: the mapping says why
  const get = (ids) => ids.map((id) => {
    const e = byKey.get(`w${id}`);
    if (!e) throw new Error(`${h.nine} ${h.hole}: way ${id} is not in the extract`);
    return { key: `w${id}`, ring: ringsOf(e)[0] };
  });
  const tees = get(h.tees);
  const greens = get(h.greens);
  const fairways = get(h.fairways ?? []);
  // The green centre: the greens' area-weighted middle. The back tee: the one farthest from it.
  const weight = greens.map((g) => Math.abs(ringArea(g.ring)));
  const centres = greens.map((g) => ringCentroid(g.ring));
  const total = weight.reduce((s, w) => s + w, 0);
  const G = [centres.reduce((s, c, i) => s + c[0] * weight[i], 0) / total, centres.reduce((s, c, i) => s + c[1] * weight[i], 0) / total];
  const back = tees.map((t) => ringCentroid(t.ring)).reduce((far, c) => (Math.hypot(c[0] - G[0], c[1] - G[1]) > Math.hypot(far[0] - G[0], far[1] - G[1]) ? c : far));
  // A par 3 is played straight at the green, over any strip of fairway on the way.
  const line = playLine(back, G, h.par > 3 ? fairways.map((f) => f.ring) : []);
  // The hole's rough: the rough areas round its own tees, greens and fairways.
  const own = [...tees, ...greens, ...fairways].map((f) => ringCentroid(f.ring));
  const rough = roughs.filter((r) => own.some((c) => inRing(c, r.rings[0])));
  const near = [...greens, ...fairways].map((f) => f.ring);
  const holeBunkers = bunkers.filter((b) => {
    const c = ringCentroid(b.rings[0]);
    return rough.some((r) => inRing(c, r.rings[0])) || near.some((ring) => ringDistance(c, ring) <= BUNKER_NEAR);
  });
  const play = [...near, ...tees.map((t) => t.ring)];
  const holeWater = water.filter((w) => {
    const outer = w.rings[0];
    return rough.some((r) => ringsApart(outer, r.rings[0]) === 0) || play.some((ring) => ringsApart(outer, ring) <= WATER_NEAR)
      || line.some((p, i) => i > 0 && outer.some((q) => segmentDistance(q, line[i - 1], p) <= WATER_NEAR));
  });
  const entry = {
    line: line.flatMap(([x, y]) => [round(x - G[0]), round(y - G[1])]),
    greens: greens.map((g) => flat(g.ring, G, TOL.green)),
    tees: tees.map((t) => flat(t.ring, G, TOL.tee)),
    fairways: fairways.map((f) => flat(f.ring, G, TOL.fairway)),
    bunkers: holeBunkers.map((b) => flat(b.rings[0], G, TOL.bunker)),
    water: holeWater.map((w) => w.rings.map((ring) => flat(ring, G, TOL.water))),
    osm: {
      tees: tees.map((t) => t.key), greens: greens.map((g) => g.key), fairways: fairways.map((f) => f.key),
      bunkers: holeBunkers.map((b) => b.key), water: holeWater.map((w) => w.key),
    },
  };
  out.holes[h.nine][h.hole - 1] = entry;
  const nine = official.nines.find((n) => n.id === h.nine);
  const len = nine.holes?.[h.hole - 1]?.distances?.[0]?.length;
  const measured = lineLength(line);
  console.log(`${h.nine} ${h.hole}: par ${nine.par[h.hole - 1]} (mapping ${h.par}), official ${len} m, line ${measured.toFixed(0)} m (${(((measured - len) / len) * 100).toFixed(1)}%), straight ${Math.hypot(back[0] - G[0], back[1] - G[1]).toFixed(0)} m; ${greens.length} greens, ${tees.length} tees, ${fairways.length} fairways, ${holeBunkers.length} bunkers, ${holeWater.length} water`);
}

const text = `${JSON.stringify(out)}\n`;
writeFileSync(OUT, text);
const mapped = mapping.holes.filter((h) => h.tees).length;
console.log(`wrote ${OUT}: ${mapped} holes, ${text.length.toLocaleString('en')} bytes, OSM data of ${out.osmBase}`);
