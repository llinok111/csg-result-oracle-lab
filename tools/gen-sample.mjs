// tools/gen-sample.mjs — deterministic adversarial corpus for the CSG result oracle.
// No randomness: the same command produces byte-identical output (sha256 printed + stored).
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { boxTris, rotZMesh, scaleMesh, translateMesh } from '../src/core.mjs';

const box = (lo, hi) => boxTris(lo, hi);

// Volume of an axis-aligned box (the only ground truth we use: closed form, independent of CSG).
const boxVol = (lo, hi) => (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
const aabbOverlap = (alo, ahi, blo, bhi) =>
  boxVol(alo.map((v, i) => Math.max(v, blo[i])), ahi.map((v, i) => Math.min(v, bhi[i])));
const clamp0 = (v) => (v > 0 ? v : 0);

const c = (id, alo, ahi, blo, bhi, note) => ({ id, A: box(alo, ahi), B: box(blo, bhi), alo, ahi, blo, bhi, note, analytic: true });

const raw = [
  c('overlap-boxes', [0, 0, 0], [2, 2, 2], [1, 1, 1], [3, 3, 3], 'generic crossing, no shared planes'),
  c('coplanar-subset', [0, 0, 0], [2, 2, 2], [0, 0, 0], [2, 1, 2], 'B inside A, 5 coincident face planes'),
  c('identical', [0, 0, 0], [2, 2, 2], [0, 0, 0], [2, 2, 2], 'A == B, degenerate subtract -> empty'),
  c('nested', [0, 0, 0], [4, 4, 4], [1, 1, 1], [2, 2, 2], 'strict nesting, no shared planes'),
  c('disjoint', [0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3], 'disjoint, empty intersect'),
  c('face-touch', [0, 0, 0], [1, 1, 1], [1, 0, 0], [2, 1, 1], 'share exactly one face plane x=1, empty intersect'),
  c('edge-touch', [0, 0, 0], [1, 1, 1], [1, 1, 0], [2, 2, 1], 'share exactly one edge, empty intersect'),
  c('thin-sliver', [0, 0, 0], [2, 2, 2], [0.999999, 0, 0], [1.000001, 2, 2], '2e-6 thick slab crossing A'),
  c('near-coincident', [0, 0, 0], [2, 2, 2], [1 + 1e-9, 0, 0], [3, 2, 2], 'planes 1e-9 apart'),
  { id: 'rotated-cross', A: box([-1, -1, -1], [1, 1, 1]), B: translateMesh(rotZMesh(box([-1, -0.5, -1], [1, 0.5, 1]), Math.PI / 4), [1.2, 0.1, 0]), note: 'B rotated 45deg about z: no closed-form volume oracle', analytic: false },
];

const scales = [1e-6, 1e-3, 1e3, 1e6];
for (const s of scales) {
  raw.push({
    id: `scale-${s}`,
    A: scaleMesh(box([0, 0, 0], [2, 2, 2]), s),
    B: scaleMesh(box([1, 1, 1], [3, 3, 3]), s),
    alo: [0, 0, 0].map(v => v * s), ahi: [2, 2, 2].map(v => v * s),
    blo: [1, 1, 1].map(v => v * s), bhi: [3, 3, 3].map(v => v * s),
    note: `overlap-boxes uniformly scaled by ${s}`,
    analytic: true,
    uniformScaleOf: 'overlap-boxes',
  });
}

const cases = raw.map(k => {
  const out = { id: k.id, note: k.note, analytic: k.analytic, A: k.A, B: k.B };
  if (k.uniformScaleOf) out.uniformScaleOf = k.uniformScaleOf;
  if (k.analytic) {
    const VA = boxVol(k.alo, k.ahi), VB = boxVol(k.blo, k.bhi);
    const VI = clamp0(aabbOverlap(k.alo, k.ahi, k.blo, k.bhi));
    out.expected = { union: VA + VB - VI, intersect: VI, subtract: VA - VI, VA, VB, VI };
  }
  return out;
});

const doc = {
  name: 'csg-result-oracle corpus',
  version: 1,
  ops: ['union', 'intersect', 'subtract'],
  groundTruth: 'expected volumes come from closed-form AABB volume/overlap, implemented in tools/gen-sample.mjs; no CSG code is involved',
  cases,
};
const text = JSON.stringify(doc, null, 1);
mkdirSync('data', { recursive: true });
writeFileSync('data/corpus.json', text + '\n');
const sha = createHash('sha256').update(text + '\n').digest('hex');
console.log(`wrote data/corpus.json  cases=${cases.length}  analytic=${cases.filter(c => c.analytic).length}  bytes=${text.length + 1}`);
console.log(`sha256=${sha}`);
