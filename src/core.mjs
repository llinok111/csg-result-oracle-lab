// src/core.mjs — CSG boolean RESULT audit oracle.
// Pure ES module: no three.js, no window/document/navigator, no fs, no network.
// The oracle NEVER calls the BSP boolean, and shares no constant with it.
//   oracle side : divergence-theorem volume, welded-edge topology,
//                 Moeller-Trumbore ray membership with seeded random directions.
//   DUT side    : BSP boolean (bounded, separated, coplanar-aware vs naive).
// Only cross-cutting tolerance is epsK * bboxDiag (relative, scale free); disclosed in README.

// ---------------------------------------------------------------- vec3
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l === 0 ? null : [a[0] / l, a[1] / l, a[2] / l]; };

// ---------------------------------------------------------------- deterministic RNG
export function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------- primitives (triangle soup meshes)
// A mesh is { tris: [ [[x,y,z],[x,y,z],[x,y,z]], ... ] } — triangle soup, no shared indices.
export function boxTris(min, max) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const tris = [];
  for (const q of quads) { tris.push([v[q[0]], v[q[1]], v[q[2]]]); tris.push([v[q[0]], v[q[2]], v[q[3]]]); }
  return { tris };
}
export function scaleMesh(m, s) { return { tris: m.tris.map(t => t.map(p => mul(p, s))) }; }
export function translateMesh(m, d) { return { tris: m.tris.map(t => t.map(p => add(p, d))) }; }
export function rotZMesh(m, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { tris: m.tris.map(t => t.map(([x, y, z]) => [c * x - s * y, s * x + c * y, z])) };
}
export function mergeMeshes(...ms) { return { tris: ms.flatMap(m => m.tris.map(t => t.map(p => p.slice()))) }; }
export function meshCount(m) { return m.tris.length; }

export function bbox(m) {
  if (m.tris.length === 0) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of m.tris) for (const p of t) for (let i = 0; i < 3; i++) { if (p[i] < lo[i]) lo[i] = p[i]; if (p[i] > hi[i]) hi[i] = p[i]; }
  return { lo, hi };
}
function bboxUnion(a, b) {
  if (!a) return b; if (!b) return a;
  return { lo: a.lo.map((v, i) => Math.min(v, b.lo[i])), hi: a.hi.map((v, i) => Math.max(v, b.hi[i])) };
}
export function bboxDiag(bb) { return bb ? Math.hypot(bb.hi[0] - bb.lo[0], bb.hi[1] - bb.lo[1], bb.hi[2] - bb.lo[2]) : 0; }

// ---------------------------------------------------------------- volume / area (divergence theorem)
export function signedVolume(m) {
  let v = 0;
  for (const t of m.tris) v += dot(t[0], cross(t[1], t[2])) / 6;
  return v;
}
export function volume(m) { return Math.abs(signedVolume(m)); }
export function surfaceArea(m) {
  let a = 0;
  for (const t of m.tris) a += 0.5 * Math.hypot(...cross(sub(t[1], t[0]), sub(t[2], t[0])));
  return a;
}
export function triangleArea(t) { return 0.5 * Math.hypot(...cross(sub(t[1], t[0]), sub(t[2], t[0]))); }

// ---------------------------------------------------------------- topology audit
const keyOf = (p, inv) => `${Math.round(p[0] * inv)}|${Math.round(p[1] * inv)}|${Math.round(p[2] * inv)}`;
function pointSegDist(p, a, b) {
  const ab = sub(b, a); const d = dot(ab, ab);
  const t = d === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / d));
  return Math.hypot(...sub(p, add(a, mul(ab, t))));
}
export function meshStats(m, eps) {
  const inv = 1 / Math.max(eps, Number.MIN_VALUE);
  const vmap = new Map(); const vpos = []; let vid = 0;
  const triV = m.tris.map(t => t.map(p => {
    const k = keyOf(p, inv);
    if (!vmap.has(k)) { vmap.set(k, vid); vpos[vid] = p; vid++; }
    return vmap.get(k);
  }));
  const seen = new Map(), dup = new Set(), edgeDir = new Map();
  for (const tv of triV) {
    const k = tv.join(',');
    if (seen.has(k)) dup.add(k); else seen.set(k, 1);
    for (let i = 0; i < 3; i++) {
      const a = tv[i], b = tv[(i + 1) % 3];
      const ek = a < b ? `${a}_${b}` : `${b}_${a}`;
      const dir = a < b ? 1 : -1;
      const e = edgeDir.get(ek) || { fwd: 0, bwd: 0 };
      if (dir > 0) e.fwd++; else e.bwd++;
      edgeDir.set(ek, e);
    }
  }
  let boundaryAll = 0, nonManifold = 0, inconsistent = 0, tjunction = 0;
  for (const [k, e] of edgeDir) {
    const total = e.fwd + e.bwd;
    if (total > 2) { nonManifold++; continue; }
    if (total === 2) { if (e.fwd !== 1 || e.bwd !== 1) inconsistent++; continue; }
    // single-incidence edge: a real hole unless a welded vertex splits it (T-junction).
    boundaryAll++;
    const [ia, ib] = k.split('_').map(Number);
    let covered = false;
    for (let v = 0; v < vpos.length && !covered; v++) {
      if (v === ia || v === ib) continue;
      if (pointSegDist(vpos[v], vpos[ia], vpos[ib]) > eps) continue;
      const k1 = ia < v ? `${ia}_${v}` : `${v}_${ia}`;
      const k2 = v < ib ? `${v}_${ib}` : `${ib}_${v}`;
      if (edgeDir.has(k1) && edgeDir.has(k2)) covered = true;
    }
    if (covered) tjunction++;
  }
  const boundary = boundaryAll - tjunction;
  const sv = signedVolume(m);
  const degenerate = m.tris.filter(t => triangleArea(t) <= eps * eps).length;
  return {
    triangles: m.tris.length, vertices: vmap.size, edges: edgeDir.size,
    boundaryEdges: boundary, tjunctionEdges: tjunction, singleEdgesAll: boundaryAll,
    nonManifoldEdges: nonManifold, inconsistentEdges: inconsistent,
    duplicateTriangles: dup.size, degenerateTriangles: degenerate,
    openEdges: boundary + inconsistent,
    signedVolume: sv, volume: Math.abs(sv), area: surfaceArea(m),
    euler: m.tris.length ? vmap.size - edgeDir.size + m.tris.length : 0,
    watertight: m.tris.length > 0 && boundary === 0 && nonManifold === 0 && inconsistent === 0,
    bbox: bbox(m),
  };
}

// ---------------------------------------------------------------- membership oracle (independent of BSP)
function rayTri(o, d, a, b, c) {
  const e1 = sub(b, a), e2 = sub(c, a);
  const pv = cross(d, e2), det = dot(e1, pv);
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det, tv = sub(o, a);
  const u = dot(tv, pv) * inv;
  if (u < 0 || u > 1) return null;
  const qv = cross(tv, e1);
  const v = dot(d, qv) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, qv) * inv;
  return t > 1e-12 ? t : null;
}
export function pointInMesh(m, p, d) {
  let n = 0;
  for (const t of m.tris) if (rayTri(p, d, t[0], t[1], t[2]) !== null) n++;
  return (n & 1) === 1;
}
// No near-surface band is excluded: random directions make edge/vertex grazing measure-zero.
// All three meshes are first divided by diag(bbox(A) u bbox(B)) so the ray epsilon below is
// scale free and is NOT derived from the DUT output.
export function membershipAudit(A, B, R, op, n, seed) {
  const bb = bboxUnion(bbox(A), bbox(B));
  const inv = 1 / Math.max(bboxDiag(bb), Number.MIN_VALUE);
  A = scaleMesh(A, inv); B = scaleMesh(B, inv); R = scaleMesh(R, inv);
  const pad = bb.lo.map((v, i) => v - (bb.hi[i] - v) * 0.02);
  const span = bb.lo.map((v, i) => (bb.hi[i] - v) * 1.04);
  const rnd = lcg(seed);
  let mismatch = 0, witness = null;
  for (let i = 0; i < n; i++) {
    const p = [pad[0] + rnd() * span[0], pad[1] + rnd() * span[1], pad[2] + rnd() * span[2]];
    let d = nrm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
    while (!d) d = nrm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
    const inA = pointInMesh(A, p, d), inB = pointInMesh(B, p, d);
    const expected = op === 'union' ? (inA || inB) : op === 'intersect' ? (inA && inB) : (inA && !inB);
    const got = pointInMesh(R, p, d);
    if (expected !== got) { mismatch++; if (!witness) witness = { p, expected, got }; }
  }
  return { points: n, mismatch, witness, seed };
}

// Two DIFFERENT roles that deliberately have separate names and separate override points.
// They currently default to the same number; the README does NOT claim independence of this
// dimension — instead bench/verify.mjs assertion A11 sweeps it over 4 orders of magnitude.
export const BOOLEAN_PLANE_EPS_K = 1e-9; // BSP half-space classification (DUT side)
export const ORACLE_WELD_EPS_K = 1e-9;   // oracle vertex welding, relative to bboxDiag(inputs)

// ---------------------------------------------------------------- BSP boolean (the DUT)
const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;
function planeFromPoints(a, b, c) {
  const n = nrm(cross(sub(b, a), sub(c, a)));
  return n ? { n, w: dot(n, a) } : null;
}
function splitPolygon(poly, plane, cf, cb, f, b, eps, naiveCoplanar) {
  let type = 0; const types = [];
  for (const v of poly.verts) {
    const t = dot(plane.n, v) - plane.w;
    const ty = t < -eps ? BACK : (t > eps ? FRONT : COPLANAR);
    type |= ty; types.push(ty);
  }
  if (type === COPLANAR) {
    if (naiveCoplanar || dot(poly.plane.n, plane.n) > 0) cf.push(poly); else cb.push(poly);
    return;
  }
  if (type === FRONT) { f.push(poly); return; }
  if (type === BACK) { b.push(poly); return; }
  const fv = [], bv = [];
  for (let i = 0; i < poly.verts.length; i++) {
    const j = (i + 1) % poly.verts.length;
    const ti = types[i], tj = types[j], vi = poly.verts[i], vj = poly.verts[j];
    if (ti !== BACK) fv.push(vi);
    if (ti !== FRONT) bv.push(vi);
    if ((ti | tj) === SPANNING) {
      const t = (plane.w - dot(plane.n, vi)) / dot(plane.n, sub(vj, vi));
      const nv = add(vi, mul(sub(vj, vi), t));
      fv.push(nv); bv.push(nv);
    }
  }
  if (fv.length >= 3) f.push({ verts: fv, plane: poly.plane });
  if (bv.length >= 3) b.push({ verts: bv, plane: poly.plane });
}
class Node {
  constructor(polys, eps, naive) { this.plane = null; this.front = null; this.back = null; this.polys = []; this.eps = eps; this.naive = naive; if (polys && polys.length) this.build(polys); }
  invert() {
    for (const p of this.polys) { p.verts.reverse(); p.plane = { n: mul(p.plane.n, -1), w: -p.plane.w }; }
    if (this.plane) this.plane = { n: mul(this.plane.n, -1), w: -this.plane.w };
    const t = this.front; this.front = this.back; this.back = t;
    if (this.front) this.front.invert(); if (this.back) this.back.invert();
  }
  clipPolygons(polys) {
    if (!this.plane) return polys.slice();
    const f = [], b = [];
    for (const p of polys) splitPolygon(p, this.plane, f, b, f, b, this.eps, this.naive);
    if (this.front) this.clipPolygonsInto(f, this.front);
    if (this.back) this.back.clipPolygonsInto(b, this.back); else b.length = 0;
    return f.concat(b);
  }
  clipPolygonsInto(polys, node) { const r = node.clipPolygons(polys); polys.length = 0; for (const p of r) polys.push(p); }
  clipTo(bsp) { this.polys = bsp.clipPolygons(this.polys); if (this.front) this.front.clipTo(bsp); if (this.back) this.back.clipTo(bsp); }
  allPolygons() { let r = this.polys.slice(); if (this.front) r = r.concat(this.front.allPolygons()); if (this.back) r = r.concat(this.back.allPolygons()); return r; }
  build(polys) {
    if (!polys.length) return;
    if (!this.plane) this.plane = polys[0].plane;
    const f = [], b = [];
    for (const p of polys) splitPolygon(p, this.plane, this.polys, this.polys, f, b, this.eps, this.naive);
    if (f.length) { if (!this.front) this.front = new Node(null, this.eps, this.naive); this.front.build(f); }
    if (b.length) { if (!this.back) this.back = new Node(null, this.eps, this.naive); this.back.build(b); }
  }
}
function meshToPolys(m) {
  const out = [];
  for (const t of m.tris) { const pl = planeFromPoints(t[0], t[1], t[2]); if (pl) out.push({ verts: t.map(p => p.slice()), plane: pl }); }
  return out;
}
function polysToMesh(polys) {
  const tris = [];
  for (const p of polys) for (let i = 2; i < p.verts.length; i++) tris.push([p.verts[0].slice(), p.verts[i - 1].slice(), p.verts[i].slice()]);
  return { tris };
}
export function csg(meshA, meshB, op, opts = {}) {
  const naive = !!opts.naiveCoplanar;
  const bb = bboxUnion(bbox(meshA), bbox(meshB));
  const eps = (opts.epsK ?? BOOLEAN_PLANE_EPS_K) * Math.max(bboxDiag(bb), Number.MIN_VALUE);
  const A = new Node(meshToPolys(meshA), eps, naive);
  const B = new Node(meshToPolys(meshB), eps, naive);
  if (op === 'union') { A.clipTo(B); B.clipTo(A); B.invert(); B.clipTo(A); B.invert(); A.build(B.allPolygons()); return polysToMesh(A.allPolygons()); }
  if (op === 'intersect') { A.invert(); B.clipTo(A); B.invert(); A.clipTo(B); B.clipTo(A); A.build(B.allPolygons()); A.invert(); return polysToMesh(A.allPolygons()); }
  if (op === 'subtract') { A.invert(); A.clipTo(B); B.clipTo(A); B.invert(); B.clipTo(A); B.invert(); A.build(B.allPolygons()); A.invert(); return polysToMesh(A.allPolygons()); }
  throw new Error(`unknown op ${op}`);
}

// ---------------------------------------------------------------- the oracle
export const MODES = [
  'DEGENERATE_TRIANGLE', 'BOUNDARY_EDGE', 'NON_MANIFOLD_EDGE', 'DUPLICATE_TRIANGLE',
  'INCONSISTENT_ORIENTATION', 'MEMBERSHIP_MISMATCH', 'BBOX_MISMATCH', 'VOLUME_DRIFT', 'EMPTY_RESULT',
];
// Solid-level modes mean the represented SOLID is wrong. Mesh-level modes mean the triangulation
// is unclean while the solid may still be exact (BSP splitting leaves T-junctions).
export const SOLID_MODES = ['DEGENERATE_TRIANGLE', 'INCONSISTENT_ORIENTATION', 'MEMBERSHIP_MISMATCH', 'BBOX_MISMATCH', 'VOLUME_DRIFT', 'EMPTY_RESULT'];
export const MESH_MODES = ['BOUNDARY_EDGE', 'NON_MANIFOLD_EDGE', 'DUPLICATE_TRIANGLE'];
export function auditResult(A, B, R, op, opts = {}) {
  const epsK = opts.epsK ?? ORACLE_WELD_EPS_K;
  const bb = bboxUnion(bbox(A), bbox(B));
  const eps = epsK * Math.max(bboxDiag(bb), Number.MIN_VALUE);
  const st = meshStats(R, eps);
  const modes = [];
  if (st.degenerateTriangles > 0) modes.push('DEGENERATE_TRIANGLE');
  if (st.duplicateTriangles > 0) modes.push('DUPLICATE_TRIANGLE');
  if (st.nonManifoldEdges > 0) modes.push('NON_MANIFOLD_EDGE');
  if (st.boundaryEdges > 0 || st.inconsistentEdges > 0) modes.push('BOUNDARY_EDGE');
  if (st.inconsistentEdges > 0 || (st.watertight && st.signedVolume < 0)) modes.push('INCONSISTENT_ORIENTATION');
  const expectedEmpty = opts.expectedVolume !== undefined && Math.abs(opts.expectedVolume) === 0;
  if (st.triangles === 0 && !expectedEmpty) modes.push('EMPTY_RESULT');
  if (op === 'union') {
    const eb = bboxUnion(bbox(A), bbox(B));
    const slack = eps * 64;
    const ok = st.bbox && eb &&
      st.bbox.lo.every((v, i) => v >= eb.lo[i] - slack) && st.bbox.hi.every((v, i) => v <= eb.hi[i] + slack) &&
      st.bbox.lo.every((v, i) => v <= eb.lo[i] + slack) && st.bbox.hi.every((v, i) => v >= eb.hi[i] - slack);
    if (!ok) modes.push('BBOX_MISMATCH');
  }
  if (opts.expectedVolume !== undefined) {
    const rel = Math.abs(st.volume - opts.expectedVolume) / Math.max(opts.expectedVolume, eps * eps * eps, 1e-300);
    st.volumeRelError = rel;
    if (rel > (opts.volTol ?? 1e-6)) modes.push('VOLUME_DRIFT');
  }
  const mem = opts.membershipPoints === 0 ? null : membershipAudit(A, B, R, op, opts.membershipPoints ?? 1200, opts.seed ?? 20261116);
  if (mem && mem.mismatch > 0) modes.push('MEMBERSHIP_MISMATCH');
  return { op, modes, pass: modes.length === 0, solidPass: !modes.some(x => SOLID_MODES.includes(x)), stats: st, membership: mem, eps };
}

// ---------------------------------------------------------------- negative controls (deliberate corruption)
export function corrupt(mesh, kind, eps) {
  const t = mesh.tris.map(x => x.map(p => p.slice()));
  if (t.length === 0) return { tris: t };
  const rnd = lcg(987654321);
  if (kind === 'drop-triangle') return { tris: t.slice(1) };
  if (kind === 'flip-triangle') { const x = t[Math.floor(t.length / 2)]; return { tris: t.map((q, i) => (i === Math.floor(t.length / 2) ? [x[0], x[2], x[1]] : q)) }; }
  if (kind === 'jitter-vertex') {
    const i = Math.floor(t.length / 2);
    const d = [eps * 4096 * (rnd() + 0.5), eps * 4096 * (rnd() + 0.5), eps * 4096 * (rnd() + 0.5)];
    t[i] = t[i].map((p, k) => (k === 0 ? add(p, d) : p)); return { tris: t };
  }
  if (kind === 'scale-triangle') {
    const i = Math.floor(t.length / 2), tri = t[i];
    const c = mul(add(add(tri[0], tri[1]), tri[2]), 1 / 3);
    t[i] = tri.map(p => add(c, mul(sub(p, c), 1.25))); return { tris: t };
  }
  if (kind === 'duplicate-triangle') return { tris: t.concat([t[Math.floor(t.length / 2)].map(p => p.slice())]) };
  if (kind === 'scale-all') return scaleMesh(mesh, 1.5);
  throw new Error(`unknown corruption ${kind}`);
}
export const CORRUPTIONS = ['drop-triangle', 'flip-triangle', 'jitter-vertex', 'scale-triangle', 'duplicate-triangle', 'scale-all'];

// Semantic negative controls: results that are watertight, manifold, orientation-consistent,
// and self-consistent — yet WRONG. These can only be caught by referring back to A and B.
export function semanticControl(A, B, kind) {
  if (kind === 'return-a') return { tris: A.tris.map(t => t.map(p => p.slice())) };
  if (kind === 'wrong-op') return csg(A, B, 'intersect');
  if (kind === 'drop-b') return csg(A, B, 'subtract');
  throw new Error(`unknown semantic control ${kind}`);
}
export const SEMANTIC_CONTROLS = ['return-a', 'wrong-op', 'drop-b'];
