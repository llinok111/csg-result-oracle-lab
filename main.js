// main.js — rendering + interaction only. All geometry, boolean and audit numbers come from src/core.mjs.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { csg, auditResult, bbox, bboxDiag } from './src/core.mjs';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(4, 6, 5); scene.add(key);
const grid = new THREE.GridHelper(10, 20, 0x30363d, 0x21262d); scene.add(grid);

const corpus = await (await fetch('./data/corpus.json')).json();
const geoTris = (tris) => {
  const g = new THREE.BufferGeometry();
  if (!tris.length) return g;
  const p = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => t.forEach((v, j) => { p[i * 9 + j * 3] = v[0]; p[i * 9 + j * 3 + 1] = v[1]; p[i * 9 + j * 3 + 2] = v[2]; }));
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
};
const layer = (tris, color, wire) => {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geoTris(tris), new THREE.MeshLambertMaterial({ color, transparent: true, opacity: wire ? 0.35 : 0.6, side: THREE.DoubleSide, depthWrite: !wire })));
  g.add(new THREE.LineSegments(new THREE.WireframeGeometry(geoTris(tris)), new THREE.LineBasicMaterial({ color })));
  return g;
};

let current = corpus.cases[0], op = 'union', group = null;
const $ = (s) => document.querySelector(s);

function rebuild() {
  if (group) scene.remove(group);
  group = new THREE.Group();
  const scale = 1 / (bboxDiag(bbox(current.A)) || 1);
  const fit = (mesh) => ({ tris: mesh.tris.map(t => t.map(v => v.map(x => x * scale))) });
  const A = fit(current.A), B = fit(current.B);
  const R = csg(A, B, op);
  const exp = current.expected ? current.expected[op] : undefined;
  const a = auditResult(A, B, R, op, { expectedVolume: exp, membershipPoints: 3000, seed: 20261116 });
  group.add(layer(A.tris, 0x58a6ff, false));
  group.add(layer(B.tris, 0xf0883e, false));
  group.add(layer(R.tris, 0x3fb950, true));
  scene.add(group);
  const d = bboxDiag(bbox(current.A)) * scale;
  camera.position.set(1.7, 1.4, 1.9); controls.target.set(0.1, 0.1, 0.1); controls.update();
  const cls = a.pass ? 'ok' : 'bad';
  $('#line').innerHTML = `<b>${current.id}</b> / ${op} &nbsp; <- same src/core.mjs as bench/verify.mjs &nbsp; `
    + `<span class="${cls}">verdict ${a.pass ? 'PASS' : 'FAIL'} [${a.modes.join(',') || 'no modes'}]</span> &nbsp;`
    + `V=<b>${a.stats.volume.toExponential(6)}</b>`
    + (exp !== undefined ? ` expected=<b>${exp.toExponential(6)}</b> relErr=<b>${(Math.abs(a.stats.volume - exp) / Math.max(exp, 1e-300)).toExponential(2)}</b>` : ' expected=n/a')
    + ` &nbsp; tris=<b>${R.tris.length}</b> boundaryEdges=<b>${a.stats.boundaryEdges}</b> tjunctions=<b>${a.stats.tjunctionEdges}</b>`
    + ` &nbsp; membership ray-probes <b>${a.membership.mismatch}/${a.membership.points}</b> mismatched &nbsp;<span class="dim">bboxDiag=${d.toExponential(3)}</span>`;
  console.log('[csg-result-oracle-lab]', current.id, op, JSON.stringify(a).slice(0, 400));
}

corpus.cases.forEach((c, i) => { const o = document.createElement('option'); o.value = i; o.textContent = c.id; $('#case').appendChild(o); });
$('#case').onchange = (e) => { current = corpus.cases[+e.target.value]; rebuild(); };
document.querySelectorAll('button[data-op]').forEach(b => b.onclick = () => {
  op = b.dataset.op;
  document.querySelectorAll('button[data-op]').forEach(x => x.classList.toggle('on', x === b));
  rebuild();
});
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
rebuild();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
