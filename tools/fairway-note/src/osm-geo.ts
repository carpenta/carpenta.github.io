/**
 * Plane geometry for the holes drawn from OpenStreetMap (v27). Pure functions with no imports, so the build-time script
 * (scripts/osm-holes.mjs, run by hand) and the app share them: the script projects and simplifies, the app turns a hole
 * so its tee sits at the bottom of the screen and its green at the top.
 */

/** A point in metres: x east, y north (local to one course or hole). */
export type Pt = [number, number];

const A = 6378137; // WGS 84 semi-major axis, m
const E2 = 0.00669437999014; // WGS 84 first eccentricity squared

/**
 * Metres east and north of (lat0, lon0) for points within a few km of it: the ellipsoid's radii of curvature at lat0
 * (meridian for north, prime vertical for east), which is within a centimetre or two over a golf course.
 */
export function projector(lat0: number, lon0: number): (lat: number, lon: number) => Pt {
  const phi = (lat0 * Math.PI) / 180;
  const w = 1 - E2 * Math.sin(phi) ** 2;
  const north = ((A * (1 - E2)) / w ** 1.5) * (Math.PI / 180);
  const east = (A / Math.sqrt(w)) * Math.cos(phi) * (Math.PI / 180);
  return (lat, lon) => [(lon - lon0) * east, (lat - lat0) * north];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** How far p lies from the segment a–b. */
export function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Douglas–Peucker: the fewest points that keep an open line within `tol` metres of the original, ends kept. */
export function simplifyLine(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let far = -1;
    let best = tol;
    for (let k = i + 1; k < j; k++) {
      const d = segmentDistance(pts[k], pts[i], pts[j]);
      if (d > best) {
        best = d;
        far = k;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([i, far], [far, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/**
 * Douglas–Peucker on a closed ring (no repeated end point): split at the point farthest from the first, simplify both
 * halves, and keep at least a triangle so a small shape never collapses.
 */
export function simplifyRing(ring: Pt[], tol: number): Pt[] {
  const pts = ring.length > 1 && dist(ring[0], ring[ring.length - 1]) === 0 ? ring.slice(0, -1) : ring.slice();
  if (pts.length <= 3) return pts;
  let far = 1;
  for (let k = 2; k < pts.length; k++) if (dist(pts[k], pts[0]) > dist(pts[far], pts[0])) far = k;
  const a = simplifyLine(pts.slice(0, far + 1), tol);
  const b = simplifyLine([...pts.slice(far), pts[0]], tol);
  const out = [...a, ...b.slice(1, -1)];
  if (out.length >= 3) return out;
  // Too thin to keep at this tolerance: the first, the farthest and the point farthest from the line between them.
  let side = 1;
  for (let k = 1; k < pts.length; k++) if (k !== far && segmentDistance(pts[k], pts[0], pts[far]) > segmentDistance(pts[side], pts[0], pts[far])) side = k;
  return [0, far, side].sort((p, q) => p - q).map((k) => pts[k]);
}

/** Signed area (positive counter-clockwise, with y north). */
export function ringArea(ring: Pt[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** The centre of a ring's area. */
export function ringCentroid(ring: Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const c = x1 * y2 - x2 * y1;
    a += c;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  if (Math.abs(a) < 1e-9) return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  return [cx / (3 * a), cy / (3 * a)];
}

/** Whether p lies inside the ring (even–odd). */
export function inRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The length of a polyline in metres. */
export function lineLength(line: Pt[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += dist(line[i - 1], line[i]);
  return s;
}

/** The point `d` metres back from the line's end, along it; null when the line is shorter. */
export function pointFromEnd(line: Pt[], d: number): Pt | null {
  let left = d;
  for (let i = line.length - 1; i > 0; i--) {
    const seg = dist(line[i], line[i - 1]);
    if (seg >= left && seg > 0) {
      const t = left / seg;
      return [line[i][0] + (line[i - 1][0] - line[i][0]) * t, line[i][1] + (line[i - 1][1] - line[i][1]) * t];
    }
    left -= seg;
  }
  return null;
}

/**
 * The line of play from the tee to the green through the fairways: across the tee→green axis every `step` metres, the
 * middle of the widest stretch of fairway, smoothed and simplified. A hole with no fairway (a par 3) is the straight line.
 */
export function playLine(tee: Pt, green: Pt, fairways: Pt[][], step = 8, tol = 4): Pt[] {
  const L = dist(tee, green);
  if (!fairways.length || L === 0) return [tee, green];
  const ux = (green[0] - tee[0]) / L;
  const uy = (green[1] - tee[1]) / L;
  const mids: Pt[] = [];
  for (let s = step; s < L; s += step) {
    const ox = tee[0] + ux * s;
    const oy = tee[1] + uy * s;
    // Where each fairway edge crosses the perpendicular through (ox, oy), as a signed distance along it.
    const cuts: number[][] = [];
    for (const ring of fairways) {
      const at: number[] = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const da = (a[0] - ox) * ux + (a[1] - oy) * uy;
        const db = (b[0] - ox) * ux + (b[1] - oy) * uy;
        if (da > 0 === db > 0 || da === db) continue;
        const t = da / (da - db);
        at.push((a[0] + (b[0] - a[0]) * t - ox) * -uy + (a[1] + (b[1] - a[1]) * t - oy) * ux);
      }
      at.sort((p, q) => p - q);
      for (let k = 0; k + 1 < at.length; k += 2) cuts.push([at[k], at[k + 1]]);
    }
    if (!cuts.length) continue;
    const [lo, hi] = cuts.reduce((w, c) => (c[1] - c[0] > w[1] - w[0] ? c : w));
    const m = (lo + hi) / 2;
    mids.push([ox - uy * m, oy + ux * m]);
  }
  // A three-point moving average, so one ragged slice does not kink the line.
  const smooth = mids.map((p, i): Pt => {
    const a = mids[Math.max(0, i - 1)];
    const b = mids[Math.min(mids.length - 1, i + 1)];
    return [(a[0] + p[0] + b[0]) / 3, (a[1] + p[1] + b[1]) / 3];
  });
  return simplifyLine([tee, ...smooth, green], tol);
}

/**
 * The hole turned for the screen: with the line of play's tee→green axis pointing up, `u` metres to the right and `v`
 * metres down from the green centre (the line's last point). Facing the green from the tee, left stays left.
 */
export function orienter(line: Pt[]): (p: Pt) => Pt {
  const tee = line[0];
  const green = line[line.length - 1];
  const L = dist(tee, green) || 1;
  const dx = (green[0] - tee[0]) / L;
  const dy = (green[1] - tee[1]) / L;
  return ([x, y]) => {
    const px = x - green[0];
    const py = y - green[1];
    return [px * dy - py * dx, -(px * dx + py * dy)];
  };
}
