// bench/bench.mjs — timing for the CSG result oracle. 1 warmup + 7 timed samples + cold start.
import { readFileSync, writeFileSync } from 'node:fs';
import * as m from '../src/core.mjs';

const doc = JSON.parse(readFileSync(new URL('../data/corpus.json', import.meta.url), 'utf8'));
const PTS = 1000;
const OPS = doc.ops;

function workload() {
  let points = 0, rays = 0;
  const rows = [];
  for (const c of doc.cases) for (const op of OPS) {
    const exp = c.expected ? c.expected[op] : undefined;
    const R = m.csg(c.A, c.B, op);
    const a = m.auditResult(c.A, c.B, R, op, { expectedVolume: exp, membershipPoints: PTS, seed: 20261116 });
    points += a.membership.points;
    rays += (a.membership.points * (c.A.tris.length + c.B.tris.length + R.tris.length));
    rows.push(a.pass);
  }
  return { points, rays, rows: rows.length };
}
function timeIt(fn) { const t = process.hrtime.bigint(); const r = fn(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, r }; }

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  return {
    n: xs.length, min: s[0], median: s[Math.floor(s.length / 2)],
    p95: s[Math.min(s.length - 1, Math.floor(0.95 * s.length))],
    max: s[s.length - 1], mean, stddev: sd, relSD: sd / mean,
  };
}

// cold start: very first execution of the whole pipeline in this process
const cold = timeIt(workload);
// warmup
timeIt(workload);
const samples = [];
let last = null;
for (let i = 0; i < 7; i++) { const t = timeIt(workload); samples.push(t.ms); last = t.r; }

// component split (median of 5) so the README number is attributable
const boolOnly = [], topoOnly = [], memOnly = [];
for (let i = 0; i < 5; i++) {
  boolOnly.push(timeIt(() => { for (const c of doc.cases) for (const op of OPS) m.csg(c.A, c.B, op); }).ms);
  topoOnly.push(timeIt(() => {
    for (const c of doc.cases) for (const op of OPS) { const R = m.csg(c.A, c.B, op); m.meshStats(R, 1e-9 * 4); }
  }).ms - boolOnly[boolOnly.length - 1]);
  memOnly.push(timeIt(() => {
    for (const c of doc.cases) for (const op of OPS) m.membershipAudit(c.A, c.B, m.csg(c.A, c.B, op), op, PTS, 20261116);
  }).ms - boolOnly[boolOnly.length - 1]);
}

const out = {
  bench: 'csg-result-oracle',
  workload: {
    corpusCases: doc.cases.length, ops: OPS.length, auditRows: last.rows,
    membershipPointsPerRow: PTS, membershipPointsTotal: last.points,
    rayTriangleTestsTotal: last.rays,
    description: 'robust BSP boolean (42 rows) + full audit: topology, divergence volume, closed-form volume error, scale-free ray-membership membership oracle',
  },
  coldStartMs: cold.ms,
  samplesMs: samples,
  total: stats(samples),
  componentsMedianMs: {
    bspBooleanOnly: stats(boolOnly).median,
    topologyAndVolumeOnly: stats(topoOnly).median,
    memoryMembershipOracleOnly: stats(memOnly).median,
  },
  throughput: {
    membershipProbesPerSecond: Math.round(last.points / (stats(samples).median / 1000)),
    rayTriangleTestsPerSecond: Math.round(last.rays / (stats(samples).median / 1000)),
  },
  env: { node: process.version, platform: process.platform, arch: process.arch, cpus: (await import('node:os')).cpus().length },
};
writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
