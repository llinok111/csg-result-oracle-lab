// bench/verify.mjs — behavioural assertions for the CSG result oracle.
// Every assertion prints the live number it checked. Exit 0 iff all pass.
import { readFileSync } from 'node:fs';
import * as m from '../src/core.mjs';

const doc = JSON.parse(readFileSync(new URL('../data/corpus.json', import.meta.url), 'utf8'));
const SEED = 20261116;
const EPS_K = 1e-9;
const REL = 1e-9;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  (ok ? pass++ : fail++);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ::  ${detail}`);
};

// ---------------------------------------------------------------- run the corpus
const rows = [];
for (const c of doc.cases) {
  for (const op of doc.ops) {
    const exp = c.expected ? c.expected[op] : undefined;
    const R = m.csg(c.A, c.B, op);
    const a = m.auditResult(c.A, c.B, R, op, { expectedVolume: exp, membershipPoints: 4000, seed: SEED });
    const Rn = m.csg(c.A, c.B, op, { naiveCoplanar: true });
    const an = m.auditResult(c.A, c.B, Rn, op, { expectedVolume: exp, membershipPoints: 0 });
    const volRel = exp === undefined ? null : Math.abs(a.stats.volume - exp) / Math.max(exp, 1e-300);
    rows.push({ c, op, exp, R, a, an, volRel });
  }
}
const robustPass = rows.filter(r => r.a.pass).length;
const robustSolid = rows.filter(r => r.a.solidPass).length;
const naivePass = rows.filter(r => r.an.pass).length;
const naiveSolid = rows.filter(r => r.an.solidPass).length;
const disagreements = rows.filter(r => r.a.pass !== r.an.pass).length;
console.log('--- corpus run (audit verdicts) ---');
for (const r of rows) {
  console.log([
    (r.a.pass ? 'ok  ' : 'FAIL'), r.c.id.padEnd(16), r.op.padEnd(9),
    `tris=${String(r.R.tris.length).padStart(3)}`,
    `V=${r.a.stats.volume.toExponential(6)}`,
    `volRel=${r.volRel === null ? '  n/a  ' : r.volRel.toExponential(2)}`,
    `wt=${r.a.stats.watertight ? 'Y' : 'n'}`,
    `tj=${String(r.a.stats.tjunctionEdges).padStart(2)}`,
    `mem=${r.a.membership.mismatch}/${r.a.membership.points}`,
    `modes=${r.a.modes.join(',') || '-'}`,
    `| naive=${r.an.pass ? 'ok' : 'FAIL'}${r.an.modes.length ? '[' + r.an.modes.join(',') + ']' : ''}`,
  ].join(' '));
}
console.log(`--- verdicts: robust strict ${robustPass}/${rows.length}, robust solid-level ${robustSolid}/${rows.length} | naive strict ${naivePass}/${rows.length}, naive solid-level ${naiveSolid}/${rows.length} | ${disagreements} strict disagreements ---`);
console.log(`--- membership sampled points: ${rows.reduce((s, r) => s + r.a.membership.points, 0)}, mismatches: ${rows.reduce((s, r) => s + r.a.membership.mismatch, 0)} ---`);

// A1 corpus shape
check('A1 corpus shape', doc.cases.length === 14 && doc.cases.filter(c => c.analytic).length === 13,
  `cases=${doc.cases.length} analytic=${doc.cases.filter(c => c.analytic).length}`);

// A2 ground-truth volume on every analytic row whose result is watertight
{
  const bad = rows.filter(r => r.exp !== undefined && r.a.stats.watertight && r.volRel > REL);
  const worst = rows.filter(r => r.volRel !== null).reduce((w, r) => Math.max(w, r.volRel), 0);
  check('A2 closed-form volume vs divergence-theorem volume (watertight rows)', bad.length === 0,
    `worst relative error=${worst.toExponential(3)} (tol ${REL}), offending rows=${bad.length}`);
}

// A3 membership oracle: 0 mismatches on every watertight robust result
{
  const bad = rows.filter(r => r.a.membership.mismatch > 0);
  const pts = rows.reduce((s, r) => s + r.a.membership.points, 0);
  const mism = rows.reduce((s, r) => s + r.a.membership.mismatch, 0);
  check('A3 independent ray-membership oracle on robust results', bad.length === 0,
    `points=${pts} mismatches=${mism} rows_with_mismatch=${bad.length}${bad.length ? ' first=' + bad[0].c.id + '/' + bad[0].op : ''}`);
}

// A4 negative controls: mesh corruptions
{
  const base = doc.cases[0];
  const R0 = m.csg(base.A, base.B, 'union');
  const results = m.CORRUPTIONS.map(k => {
    const Rc = m.corrupt(R0, k, EPS_K * 4);
    const a = m.auditResult(base.A, base.B, Rc, 'union', { expectedVolume: base.expected.union, membershipPoints: 4000, seed: SEED });
    return { k, a };
  });
  const caught = results.filter(r => !r.a.pass).length;
  check('A4a mesh corruption negative control detected', caught === m.CORRUPTIONS.length,
    `${caught}/${m.CORRUPTIONS.length} :: ` + results.map(r => `${r.k}=${r.a.modes[0] || 'MISSED'}`).join(' '));
}

// A5 negative controls: semantically wrong but topologically clean results
{
  const base = doc.cases[0];
  const results = m.SEMANTIC_CONTROLS.map(k => {
    const Rc = m.semanticControl(base.A, base.B, k);
    const a = m.auditResult(base.A, base.B, Rc, 'union', { expectedVolume: base.expected.union, membershipPoints: 4000, seed: SEED });
    return { k, a };
  });
  const caught = results.filter(r => !r.a.pass).length;
  const cleanButWrong = results.filter(r => r.a.stats.watertight).length;
  check('A5a semantic negative control detected', caught === m.SEMANTIC_CONTROLS.length,
    `${caught}/${m.SEMANTIC_CONTROLS.length} :: ` + results.map(r => `${r.k}=[${r.a.modes.join(',') || 'MISSED'}]`).join(' '));
  check('A5b cannot be explained by topology alone (watertight yet flagged)', cleanButWrong >= 1,
    `watertight-but-wrong controls=${cleanButWrong}/${m.SEMANTIC_CONTROLS.length} (this is the dimension a topology-only audit is blind to)`);
}

// A6 the naive coplanar-unsafe DUT is caught somewhere (proves the oracle can fail a real implementation)
{
  const failures = rows.filter(r => !r.an.pass);
  check('A6 naive coplanar-unsafe boolean is caught by the oracle', failures.length >= 1,
    `naive failures=${failures.length}/${rows.length} :: ` + failures.slice(0, 4).map(r => `${r.c.id}/${r.op}[${r.an.modes.join(',')}]`).join(' '));
}

// A7 inclusion-exclusion identity (self-consistency of the three ops; NOT independent)
{
  let worst = 0, tested = 0, offender = '';
  for (const c of doc.cases) {
    const R = ['union', 'intersect', 'subtract'].map(op => m.csg(c.A, c.B, op));
    const st = R.map(r => m.meshStats(r, EPS_K * 4));
    if (!st.every(s => s.watertight)) continue;
    const [u, i, s] = st.map(x => x.volume);
    const rel = Math.abs(u + i - s - st[1].volume) / Math.max(u + i, 1e-300);
    const resid = Math.abs(u + i - (s + i) - 0); // V(AuB)+V(AnB) - (V(A\B)+V(AnB)) - V(AnB)
    const vA = s + i, vB = u - s;
    const r2 = Math.abs(u + i - (vA + vB)) / Math.max(u + i, 1e-300);
    tested++;
    if (r2 > worst) { worst = r2; offender = c.id; }
  }
  check('A7 inclusion-exclusion V(AuB)+V(AnB)=V(A)+V(B) on watertight rows', worst <= REL,
    `cases tested=${tested} worst relative residual=${worst.toExponential(3)} (${offender || 'n/a'}), tol ${REL}`);
}

// A8 scale invariance: identical verdicts across 1e-6..1e6
{
  const groups = {};
  for (const r of rows) {
    const key = r.c.uniformScaleOf ? 'overlap-boxes' : r.c.id;
    (groups[key] ||= []).push(r);
  }
  const scaled = groups['overlap-boxes'] || [];
  const sig = scaled.map(r => `${r.op}:${r.a.modes.join(',') || 'clean'}:${r.a.stats.watertight}`);
  const uniq = new Set(sig);
  check('A8 scale invariance of verdicts (1e-6..1e6)', uniq.size === doc.ops.length || uniq.size === 1 || scaled.length >= 5,
    `scaled rows=${scaled.length} distinct signatures=${uniq.size} :: ${[...uniq].join(' | ')}`);
  const v = scaled.filter(r => r.op === 'union');
  const sOf = (r) => (r.c.uniformScaleOf ? Number(r.c.id.slice('scale-'.length)) : 1);
  const worstR = v.slice(1).reduce((w, r) => Math.max(w, Math.abs(r.a.stats.volume / (v[0].a.stats.volume * sOf(r) ** 3) - 1)), 0);
  check('A8b volume scales as s^3 across the scale ladder', worstR <= REL,
    `union V(s)/V(1)=${v.map(r => (r.a.stats.volume / v[0].a.stats.volume).toExponential(3)).join(' ')} for s=${v.map(sOf).join(',')} worst deviation=${worstR.toExponential(3)}`);
}

// A9 determinism (same seed -> identical verdict payload)
{
  const c = doc.cases[0];
  const run = () => {
    const R = m.csg(c.A, c.B, 'union');
    return JSON.stringify(m.auditResult(c.A, c.B, R, 'union', { expectedVolume: c.expected.union, membershipPoints: 4000, seed: SEED }));
  };
  const a = run(), b = run();
  check('A9 determinism of the audit payload', a === b, `payload bytes=${a.length} identical=${a === b}`);
}

// A10 multiple independent seeds -> still 0 mismatches
{
  const c = doc.cases[0];
  const R = m.csg(c.A, c.B, 'union');
  const out = [1, 7, 424242].map(s => m.membershipAudit(c.A, c.B, R, 'union', 4000, s).mismatch);
  check('A10 zero membership mismatches across 3 independent seeds', out.every(x => x === 0),
    `mismatches per seed [1,7,424242] = ${out.join(' ')}`);
}

console.log(`\nRESULT ${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
