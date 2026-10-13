import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { initialState, move, turn, release, describe, keyboardMoveTarget } from './control-state.js';
import { applyPose, movementDelta } from './control-pose.js';
import { fitPerspective, panelFraming } from './camera-fit.js';

const $ = id => document.getElementById(id);
const canvas = $('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (error) {
  $('loading').textContent = 'The 3D viewer could not start. Enable browser hardware acceleration and refresh to try again.';
  $('load-status').textContent = '3D graphics unavailable';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setClearColor(0xcbd3d3);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
camera.position.set(7, 4.15, 8.75);
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room, 0.04);
scene.environment = environment.texture;
scene.environmentIntensity = 0.8;
room.dispose(); pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xf1f8ff, 0x727066, 2));
const key = new THREE.DirectionalLight(0xfff4dd, 3);
key.position.set(3, 9, 6); scene.add(key);
const fill = new THREE.DirectionalLight(0xd7e9ff, 1.7);
fill.position.set(-6, 4, -2); scene.add(fill);
const ground = new THREE.Mesh(new THREE.CircleGeometry(35, 80), new THREE.MeshStandardMaterial({ color: 0x9ca9aa, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.025; scene.add(ground);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const entries = new Map();
let selected, mode = 'move', drag = null, truck, currentView = 'truck';
let truckFitPoints = [];
let panelFitPoints = [];
let pumpPose = [[0, 1.54, 5.1], [0, 1.44, 3.22]];
// Capture handle events before OrbitControls receives them. Empty-space events still orbit.
canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
const orbit = new OrbitControls(camera, canvas);
orbit.target.set(0, 1.3, 0);
orbit.enableDamping = true;
orbit.minDistance = 0.4;
orbit.maxDistance = 24;
orbit.maxPolarAngle = Math.PI * 0.49;
canvas.tabIndex = 0;

function resize() {
  const { width, height } = $('canvas-wrap').getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height; camera.updateProjectionMatrix();
  if (truck) setView(currentView);
}
new ResizeObserver(resize).observe($('canvas-wrap'));
function render() { orbit.update(); renderer.render(scene, camera); }
renderer.setAnimationLoop(render);

function setView(name) {
  finishDrag(); currentView = name;
  const poses = {
    truck: [[7, 4.15, 8.75], [0, 1.3, 0]],
    front: [[-5.7, 3.1, -8.5], [0, 1.35, -1.3]],
    rear: [[4.8, 3.2, 9], [0, 1.4, 1]],
    pump: pumpPose,
  };
  camera.position.fromArray(poses[name][0]); orbit.target.fromArray(poses[name][1]); orbit.update();
  if (truckFitPoints.length) fitPerspective(camera, orbit.target, name === 'pump' ? panelFitPoints : truckFitPoints, name === 'pump' ? 1.7 : 8);
  orbit.update();
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
function setMode(next) {
  mode = next;
  ['move', 'turn'].forEach(m => { $(`${m}-mode`).classList.toggle('active', m === mode); $(`${m}-mode`).setAttribute('aria-pressed', String(m === mode)); });
  updateDetail();
}
$('move-mode').onclick = () => setMode('move');
$('turn-mode').onclick = () => setMode('turn');

function apply(entry) {
  const { spec, state, root, basePosition, baseQuaternion } = entry;
  applyPose(root, spec, state, basePosition, baseQuaternion);
  if (selected === entry) updateDetail(false);
  entry.button.querySelector('small').textContent = !spec.enabled ? 'inactive' : spec.lock ? state.locked ? 'locked' : 'unlocked' : spec.type === 'rotary' ? `${Math.round(state.value / (2 * Math.PI) * 100)}%` : describe(spec, state).split(' / ')[0];
}
function select(entry, fromList = false, preserveMode = false) {
  if (drag) finishDrag();
  if (selected) highlight(selected, false);
  selected = entry; highlight(entry, true);
  entries.forEach(e => e.button.classList.toggle('selected', e === entry));
  $('action-feedback').textContent = '';
  if (fromList && currentView !== 'pump') setView('pump');
  setMode(entry.spec.rotationRange ? 'turn' : preserveMode && entry.spec.lock ? mode : 'move');
}
function highlight(entry, active) {
  entry.materials.forEach(({ material, emissive, intensity }) => {
    if (!material.emissive) return;
    material.emissive.copy(active ? new THREE.Color(0xe99f31) : emissive);
    material.emissiveIntensity = active ? 0.38 : intensity;
  });
}
function action(label, callback, disabled = false) {
  const button = document.createElement('button'); button.textContent = label;
  button.disabled = disabled; button.onclick = callback; $('actions').append(button);
}
function updateDetail(rebuild = true) {
  if (!selected) return;
  const { spec, state } = selected;
  $('control-title').textContent = spec.id === 'hale_prime' ? 'HALE PRIME' : spec.label;
  $('state-label').textContent = describe(spec, state);
  $('measurements').replaceChildren();
  const metrics = [spec.positionRange ? `${(state.value * 100).toFixed(1)} cm ${spec.positionAxis[2] ? 'extension' : 'position'}` : `${(state.value * 180 / Math.PI).toFixed(1)}° rotation`];
  if (spec.lock && spec.enabled) metrics.push(state.locked ? 'Locked · movement blocked' : 'Unlocked');
  metrics.forEach(text => { const span = document.createElement('span'); span.textContent = text; $('measurements').append(span); });
  $('move-mode').disabled = !spec.enabled || !spec.positionRange;
  $('turn-mode').disabled = !spec.enabled || !(spec.lock || spec.rotationRange);
  $('instructions').textContent = !spec.enabled ? 'Operation is unconfirmed. This primer stays inactive.' : spec.rotationRange ? spec.type === 'rotary' ? 'Drag the knob left to turn counterclockwise and increase; right to decrease. Arrow keys also turn.' : 'Drag right through OFF → RUN → START. Release to keep the nearest position. Arrow keys also turn.' : mode === 'turn' ? 'Drag the handle right to lock; left to unlock. The quarter turn visibly changes the handle.' : spec.positionAxis[2] ? 'Drag the handle UP to pull out; DOWN to push in. Shift-drag turns to lock or unlock. Locked handles cannot move.' : 'Drag the handle left or right. Release to snap to a marked position.';
  if (!rebuild) return;
  $('actions').replaceChildren();
  if (!spec.enabled) return;
  if (spec.lock) action(state.locked ? 'Turn to unlock' : 'Turn to lock', () => {
    turn(spec, state, state.locked ? 0 : 1); apply(selected); updateDetail(); $('action-feedback').textContent = state.locked ? 'Handle locked at its current position.' : 'Handle unlocked. Movement is available.';
  });
  if (spec.endpoints) spec.endpoints.forEach(p => action(p.state, () => {
    if (spec.rotationRange) turn(spec, state, p.value);
    else if (!move(spec, state, p.value)) { $('action-feedback').textContent = 'Locked. Turn to unlock before moving.'; return; }
    release(spec, state); apply(selected); $('action-feedback').textContent = '';
  }));
  if (spec.type === 'rotary') {
    action('↶ Increase', () => { turn(spec, state, state.value + Math.PI / 6); apply(selected); });
    action('↷ Decrease', () => { turn(spec, state, state.value - Math.PI / 6); apply(selected); });
  }
  action('Focus handle', focusHandle);
}
function focusHandle() {
  if (!selected) return;
  finishDrag();
  const center = new THREE.Box3().setFromObject(selected.root).getCenter(new THREE.Vector3());
  orbit.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(0.12, 0.12, 1.15)); orbit.update();
  currentView = 'pump';
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === 'pump'));
}
function pick(event) {
  const r = canvas.getBoundingClientRect();
  pointer.set((event.clientX - r.left) / r.width * 2 - 1, -(event.clientY - r.top) / r.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (!truck) return;
  // Use the nearest surface in the actual truck, so opaque bodywork blocks handles.
  const hit = raycaster.intersectObject(truck, true)[0];
  if (!hit) return;
  let object = hit.object;
  while (object && !object.userData.controlId) object = object.parent;
  return entries.get(object?.userData.controlId);
}
function onPointerDown(event) {
  if (event.button !== 0 || drag) return;
  const entry = pick(event); if (!entry) return;
  event.stopImmediatePropagation(); event.preventDefault();
  select(entry, false, entry === selected); canvas.focus({ preventScroll: true });
  if (!entry.spec.enabled) return;
  orbit.enabled = false;
  canvas.setPointerCapture(event.pointerId);
  const chosenMode = entry.spec.rotationRange || entry.spec.lock && (event.shiftKey || mode === 'turn') ? 'turn' : 'move';
  // Lateral drags follow projected +X. Pull handles use a consistent vertical gesture,
  // including a directly rear-on camera where the projected pull axis has zero length.
  const origin = entry.root.getWorldPosition(new THREE.Vector3());
  const end = origin.clone().add(new THREE.Vector3(...(entry.spec.positionAxis ?? [1, 0, 0])));
  origin.project(camera); end.project(camera);
  const r = canvas.getBoundingClientRect();
  const px = (end.x - origin.x) * r.width / 2;
  drag = { entry, id: event.pointerId, x: event.clientX, y: event.clientY, value: entry.state.value, locked: entry.state.locked, mode: chosenMode, pixelsPerMeter: Math.max(90, Math.abs(px)), direction: Math.sign(px) || 1 };
  $('action-feedback').textContent = chosenMode === 'move' && entry.state.locked ? 'Locked. Turn to unlock before moving.' : '';
  canvas.style.cursor = chosenMode === 'turn' ? 'ew-resize' : entry.spec.positionAxis?.[2] ? 'ns-resize' : 'ew-resize';
}
canvas.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  const { entry, x, y, value, locked } = drag; const dx = event.clientX - x, dy = event.clientY - y;
  if (drag.mode === 'turn') {
    if (entry.spec.lock) turn(entry.spec, entry.state, (locked ? 1 : 0) + dx / 90);
    else turn(entry.spec, entry.state, value - dx * (entry.spec.type === 'rotary' ? Math.PI / 150 : 0.004));
  } else {
    const delta = movementDelta(entry.spec, dx, dy, drag.pixelsPerMeter, drag.direction);
    if (!move(entry.spec, entry.state, value + delta)) $('action-feedback').textContent = 'Locked. Position unchanged. Turn to unlock first.';
  }
  apply(entry);
});
function finishDrag(event) {
  if (!drag || event && event.pointerId !== drag.id) return;
  const ended = drag; drag = null;
  release(ended.entry.spec, ended.entry.state); apply(ended.entry); updateDetail();
  orbit.enabled = true; canvas.style.cursor = '';
  if (canvas.hasPointerCapture(ended.id)) canvas.releasePointerCapture(ended.id);
}
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => canvas.addEventListener(type, finishDrag));
window.addEventListener('blur', () => finishDrag());
canvas.addEventListener('keydown', event => {
  if (!selected || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'l', 'L'].includes(event.key)) return;
  event.preventDefault(); const { spec, state } = selected;
  if (event.key.toLowerCase() === 'l' && spec.lock) { turn(spec, state, state.locked ? 0 : 1); }
  else if (spec.rotationRange) {
    const sign = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? 1 : -1;
    turn(spec, state, state.value + sign * (spec.type === 'threePositionRotary' ? 0.325 : Math.PI / 12)); release(spec, state);
  } else {
    const sign = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1;
    if (!move(spec, state, keyboardMoveTarget(spec, state, sign))) $('action-feedback').textContent = 'Locked. Turn to unlock before moving.';
    release(spec, state);
  }
  apply(selected); updateDetail();
});
$('reset').onclick = () => {
  finishDrag(); entries.forEach(e => { e.state = initialState(e.spec); apply(e); });
  updateDetail(); $('action-feedback').textContent = 'All controls returned to their starting positions.';
};

function mergeStatic(model) {
  // Retain the complete control hierarchy. Batch only immutable meshes by material
  // and compatible vertex attributes; all geometry is baked in model-local space.
  model.updateMatrixWorld(true);
  const groups = new Map(); let before = 0;
  model.traverse(mesh => {
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    let ancestor = mesh; while (ancestor && ancestor !== model && !ancestor.userData.controlId) ancestor = ancestor.parent;
    if (ancestor?.userData.controlId) return;
    before++;
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    const signature = Object.keys(g.attributes).sort().map(k => `${k}:${g.attributes[k].itemSize}:${g.attributes[k].normalized}:${g.attributes[k].array.constructor.name}`).join(',');
    const id = `${mesh.material.uuid}:${signature}`;
    if (!groups.has(id)) groups.set(id, { material: mesh.material, originals: [], geometries: [] });
    const group = groups.get(id); group.originals.push(mesh); group.geometries.push(g);
  });
  let batches = 0;
  groups.forEach(group => {
    const geometry = mergeGeometries(group.geometries, false);
    if (geometry) {
      const mesh = new THREE.Mesh(geometry, group.material); mesh.name = 'static_batch'; model.add(mesh);
      group.originals.forEach(m => m.removeFromParent()); batches++;
    }
    group.geometries.forEach(g => g.dispose());
  });
  return { before, batches };
}
async function load() {
  const response = await fetch('/models/b54-controls.json');
  if (!response.ok) throw new Error(`Control manifest failed (${response.status})`);
  const manifest = await response.json();
  panelFitPoints = panelFraming(manifest);
  pumpPose = [manifest.rearPanel.suggestedCamera, manifest.rearPanel.suggestedTarget ?? manifest.rearPanel.center];
  const gltf = await new GLTFLoader().loadAsync('/models/b54.glb', event => {
    if (event.total) $('loading').textContent = `Loading B54 · ${Math.round(event.loaded / event.total * 100)}%`;
  });
  truck = gltf.scene; scene.add(truck);
  truck.updateMatrixWorld(true);
  // Mesh-local bounds are substantially tighter than the truck's single axis-aligned
  // box. Capture their corners before static batching, then fit each viewing direction.
  truck.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox(); const box = mesh.geometry.boundingBox;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) truckFitPoints.push(new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld));
  });
  for (const spec of manifest.controls) {
    const root = truck.getObjectByName(spec.node);
    if (!root) throw new Error(`Model is missing handle ${spec.node}`);
    root.userData.controlId = spec.id;
    const materials = [];
    root.traverse(object => {
      if (!object.isMesh) return;
      const clone = material => {
        const m = material.clone(); materials.push({ material: m, emissive: m.emissive?.clone(), intensity: m.emissiveIntensity }); return m;
      };
      object.material = Array.isArray(object.material) ? object.material.map(clone) : clone(object.material);
    });
    const button = document.createElement('button');
    const label = document.createElement('span'); label.textContent = spec.id === 'hale_prime' ? 'HALE PRIME' : spec.label;
    button.append(label, document.createElement('small')); $('control-list').append(button);
    const entry = { spec, root, state: initialState(spec), basePosition: root.position.clone(), baseQuaternion: root.quaternion.clone(), materials, button };
    entries.set(spec.id, entry); button.onclick = () => select(entry, true); apply(entry);
  }
  const batchStats = mergeStatic(truck);
  $('loading').classList.add('hidden'); $('load-status').textContent = `${entries.size} controls · ready`;
  select(entries.get('tank_fill')); setView('truck');
  // Read-only diagnostics for local browser QA; no state mutation API.
  window.b54Viewer = { snapshot: () => ({ selected: selected?.spec.id, mode, orbitEnabled: orbit.enabled, dragging: !!drag, staticBatches: batchStats, drawCalls: renderer.info.render.calls, controls: [...entries.values()].map(e => ({ id: e.spec.id, value: e.state.value, locked: e.state.locked, position: e.root.position.toArray(), quaternion: e.root.quaternion.toArray() })) }) };
}
load().catch(error => {
  console.error(error); $('loading').textContent = `B54 could not load: ${error.message}. Refresh to try again.`;
  $('load-status').textContent = 'Loading failed';
});
