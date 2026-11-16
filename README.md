# csg-result-oracle-lab

**Promise**: audit the *result* of a triangle-mesh CSG boolean and separate **solid-level** failure from **mesh-level** failure. On a 14-case adversarial corpus (42 boolean rows) the coplanar-aware BSP path is **solid-level correct on 42/42 rows** while the coplanar-unsafe baseline is **34/42** — and of 9 deliberately injected defects (6 mesh-level + 3 semantically-wrong-but-clean) the oracle catches **9/9**, while **168,000 independent ray-membership probes find 0 errors** on the robust path. Reproduce with one command: `node bench/verify.mjs`.

Baseline is **in this repo and runnable**: `csg(A, B, op, { naiveCoplanar: true })` in `src/core.mjs` (the naive simplification that sends coplanar polygons to the front half-space only); it is exercised by assertion A6 in `bench/verify.mjs`.

Upstream: none

## What it is

A failure-mode oracle for mesh-boolean output, plus the boolean implementations used as its test subjects.

The oracle never calls the BSP boolean and shares no constant with it:

| dimension | method | what it CANNOT see |
|---|---|---|
| volume | divergence theorem `(1/6)·Σ a·(b×c)` over the result triangles | nothing — exact for any closed oriented mesh, and scale-exact (`V∝s³`) |
| mesh topology | edges after welding by `1e-9·bboxDiag(A∪B)`; single-incidence ⇒ hole; a welded vertex strictly inside a single-incidence edge ⇒ **T-junction** (reported separately) | multi-vertex splits are conservatively reported as real holes (150 is an upper bound) |
| solid semantics | 4,000 seeded random points; inside/outside by Möller–Trumbore ray parity; compared against `inA ∧ inB` / `inA ∨ inB` / `inA ∧ ¬inB` computed from the **inputs** | **zero-measure defects** — a zero-area T-junction gap is invisible to ray parity |
| bounding box | `bbox(A∪B) == bbox(bbox(A) ∪ bbox(B))` (exact identity for unions) | non-union ops (bound only) |

The topology oracle and the membership oracle are complementary by construction: topology catches zero-measure split artefacts, membership catches positive-measure displacement. Neither alone is sufficient, and this repo states for each one the dimension it is blind to.

Failure modes emitted: `DEGENERATE_TRIANGLE`, `DUPLICATE_TRIANGLE`, `NON_MANIFOLD_EDGE`, `BOUNDARY_EDGE`, `INCONSISTENT_ORIENTATION` (mesh-level, `SOLID_MODES`/`MESH_MODES` in `src/core.mjs`) plus `MEMBERSHIP_MISMATCH`, `BBOX_MISMATCH`, `VOLUME_DRIFT`, `EMPTY_RESULT` (solid-level). `verdict.pass` is strict; `verdict.solidPass` ignores mesh-level modes.

## How to run

```bash
node tools/gen-sample.mjs     # writes data/corpus.json (deterministic, prints sha256)
node bench/verify.mjs         # 12 behavioural assertions, prints every number it checks, exit 0/1
node bench/bench.mjs          # warmup + 7 timed samples + cold start -> bench/result.json
python3 -m http.server 4173   # then open http://localhost:4173 — renderer shares src/core.mjs
```

The page lets you switch corpus case and boolean op; the HUD shows the verdict, the volume, the
closed-form expected volume and the live membership mismatch count computed by the **same**
`src/core.mjs` that `bench/verify.mjs` uses.

## Evidence (all numbers from `node bench/verify.mjs` and `bench/bench.mjs` on 2026-11-16, Node v24.19.0)

| measurement | value |
|---|---|
| corpus | 14 cases × 3 ops = **42 rows**, 13/14 with closed-form expected volume |
| robust path, solid-level verdicts | **42/42 pass** |
| robust path, strict verdicts (incl. mesh-level) | **27/42 pass** |
| naive coplanar-unsafe baseline, solid-level | **34/42 pass** (8 rows worse than robust) |
| naive baseline, strict | 22/42 |
| independent ray-membership oracle (robust) | **0 mismatches / 168,000 probes** (4,000 per row) |
| injected defect controls — mesh-level | **6/6 caught**: drop-triangle→`BOUNDARY_EDGE`, flip-triangle→`BOUNDARY_EDGE`, jitter-vertex→`BOUNDARY_EDGE`, scale-triangle→`BOUNDARY_EDGE`, duplicate-triangle→`DUPLICATE_TRIANGLE`, global-rescale→`BBOX_MISMATCH` |
| injected defect controls — semantically wrong but topologically clean | **3/3 caught**: `return-a`, `wrong-op`, `drop-b` → each `[BBOX_MISMATCH, VOLUME_DRIFT, MEMBERSHIP_MISMATCH]` (all three were watertight, so a topology-only audit would have passed them) |
| volume vs closed-form AABB ground truth | worst relative error **6.40e-16** (tolerance 1e-9) |
| inclusion–exclusion `V(A∪B)+V(A∩B)=V(A)+V(B)` | worst relative residual **2.07e-16** over the 5 cases where all three ops are strictly watertight (this is a self-consistency check, **not** an independent oracle) |
| scale ladder 1e-6, 1e-3, 1, 1e3, 1e6 | identical verdict signatures (`union/intersect/subtract` all clean), `V(s)/V(1)` matches `s³` with worst deviation **8.88e-16** |
| determinism | audit payload byte-identical across reruns; corpus sha256 `bf21b50f4e26c565333baa8de5729666b60a229382cf603379210041b2d9cfa9` |
| timing (42-row full audit, 42,000 probes) | cold start **174.03 ms**, median **96.04 ms** (n=7, min 91.99, p95 112.85, σ 8.63, **relSD 8.65%**) |
| component split (median) | BSP boolean 2.23 ms, topology+volume 3.01 ms, membership oracle 83.08 ms |
| throughput | 437,305 membership probes/s ≈ **21.5M ray–triangle tests/s** |

Raw output: `bench/result.json`. The 42-row verdict table (with per-row triangle count, volume, T-junction count, membership mismatch and modes) is printed by `bench/verify.mjs`; the aggregate over the corpus is 1,056 output triangles, 50 T-junction edges, 150 single-incidence edges and 1 non-manifold edge.

## 本轮创新

**B 档 — 首次把「网格布尔的**结果**」当作审计对象，并给出 solid-level 与 mesh-level 的分离判据。** 台账里没有这条线：`union-volume-lab` 是八叉树 CSG 并集的**体积积分**、`surface-intersect-lab` 是 AABB 宽相、`mesh-defect-doctor` 审计的是**通用网格**而非布尔输出；外部最接近的是 SolidWright（只给合格/不合格两级判定、绑定 Rhino）与 Open-Boolean-Benchmark（只跑性能、无正确性 oracle）。这里的差异是：对每个缺陷给出**失败模式分类 + 见证**，并**逐维声明该维看不见什么**。11-02 的定档教训是「检查存在但结构上测不到」，所以本仓库的负控制同时覆盖**拓扑干净但语义错**的一族（`return-a`/`wrong-op`/`drop-b`，三者都 watertight，纯拓扑审计必然放行），并实测 3/3 被抓 —— 这一维是被**结构性地**测到的，不是靠共享常量蒙对的。

## Known limitations

- **Absolute thresholds are disclosed**: the only cross-cutting tolerance is `epsK = 1e-9` multiplied by `bboxDiag(bbox(A) ∪ bbox(B))` — derived from the **inputs**, never from the DUT output — and it is used only for vertex welding in the topology oracle. The ray–triangle epsilon is `1e-14` but it is applied **after** dividing all three meshes by the input bbox diagonal, so it too is scale-free. **Validated scale range: 1e-6 … 1e6**; outside it, welding can merge distinct vertices (large scale) or round distinct vertices together (small scale).
- **No near-surface band is excluded.** Every sampled point counts, so a grazing ray would show up as a real witness rather than being silently skipped. Residual risk: a per-point random direction makes exact edge/vertex grazing measure-zero, but not impossible.
- **The membership oracle is blind to zero-measure defects, and so is the solid-level verdict.** Measured example: shifting one result vertex by `10·eps` (`eps = 1e-9·bboxDiag`, i.e. a 1e-8 relative displacement) yields a **strict** verdict of `FAIL [BOUNDARY_EDGE]` but a **solid-level** verdict of *pass*, with `volRel = 4.74e-16` and `0/4000` membership mismatches — because a crack has zero area and does not change the Lebesgue measure. If what you need is a closed surface, read `verdict.pass` (strict), not `verdict.solidPass`. The inverse case is `scale-all`: closed and clean, caught only at the solid level by `BBOX_MISMATCH`/`VOLUME_DRIFT`.
- **T-junction detection is a single-vertex split test.** Two-or-more vertices splitting one edge are conservatively counted as real `BOUNDARY_EDGE`. The reported 150 single-incidence edges are therefore an **upper bound** on genuine holes.
- **Ground truth exists only for axis-aligned boxes** (13/14 cases; `rotated-cross` has no closed-form volume). For that case correctness rests on the membership oracle and the inclusion–exclusion identity, not on an external formula.
- Inputs are triangle soups of **closed, orientable, non-self-intersecting** solids. Open, non-manifold or self-intersecting inputs are outside the contract; the oracle will report the symptoms but makes no guarantee about them.
- The in-repo BSP boolean is a test subject, not the product: it is solid-correct but leaves T-junctions on 15/42 rows. Use `manifold3d`/`three-bvh-csg` if you need production-grade booleans — use this repo to **check** them.

MIT © 2026 llinok111.
