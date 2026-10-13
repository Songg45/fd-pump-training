import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, move, turn, release, describe, keyboardMoveTarget } from '../src/control-state.js';
import { applyPose, movementDelta } from '../src/control-pose.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PerspectiveCamera, Vector3 } from 'three';
import { fitPerspective, panelFraming } from '../src/camera-fit.js';
const manifest = JSON.parse(readFileSync(new URL('../public/models/b54-controls.json', import.meta.url)));
const spec = id => manifest.controls.find(c => c.id === id);

test('every positive lock rejects all movement with the exact value unchanged', () => {
  for (const c of manifest.controls.filter(c => c.lock && c.enabled)) {
    const state = initialState(c);
    const middle = (c.positionRange[0] + c.positionRange[1]) / 2;
    move(c, state, middle); turn(c, state, 1);
    for (const candidate of [-Infinity, -9, 0, 0.6, 42, Infinity]) {
      assert.equal(move(c, state, candidate), false, c.id);
      release(c, state); assert.equal(state.value, middle, c.id);
    }
    turn(c, state, 0); assert.equal(move(c, state, c.positionRange[1]), true);
    assert.equal(state.value, c.positionRange[1]);
  }
});
test('all enabled movements clamp at both boundaries', () => {
  for (const c of manifest.controls.filter(c => c.enabled && c.positionRange)) {
    const s = initialState(c); move(c, s, -100); assert.equal(s.value, c.positionRange[0]);
    move(c, s, 100); assert.equal(s.value, c.positionRange[1]);
  }
});
test('suction snaps to left/closed or right/open with no stable halfway state', () => {
  const c = spec('suction'), s = initialState(c);
  move(c, s, c.positionRange[1] * 0.4); release(c, s); assert.equal(s.value, c.positionRange[0]);
  move(c, s, c.positionRange[1] * 0.6); release(c, s); assert.equal(s.value, c.positionRange[1]);
  assert.match(describe(c, s), /OPEN/);
});
test('foam snaps to prime, off and operate, and locks at its current position', () => {
  const c = spec('foam'), s = initialState(c);
  for (const [value, expected, label] of [[c.positionRange[0] * 0.9, c.positionRange[0], 'prime'], [c.positionRange[1] * 0.1, 0, 'off'], [c.positionRange[1] * 0.9, c.positionRange[1], 'operate']]) {
    move(c, s, value); release(c, s); assert.equal(s.value, expected); assert.match(describe(c, s), new RegExp(label));
  }
  turn(c, s, 1); move(c, s, c.positionRange[0]); assert.equal(s.value, c.positionRange[1]);
});
test('tank valve is reverse mapped: pulling closes', () => {
  const c = spec('tank_valve'), s = initialState(c);
  assert.equal(describe(c, s), 'open'); move(c, s, 0.6); assert.equal(describe(c, s), 'closed');
});
test('selector OFF/RUN/START persist after repeated release with no spring return', () => {
  const c = spec('engine_selector'), s = initialState(c);
  for (const p of c.endpoints) {
    turn(c, s, p.value); for (let i = 0; i < 10; i++) release(c, s);
    assert.equal(s.value, p.value); assert.equal(describe(c, s), p.state);
  }
  turn(c, s, -0.4); release(c, s); assert.equal(s.value, -0.325);
});
test('throttle counterclockwise increases and clamps to the provisional one-turn range', () => {
  const c = spec('throttle'), s = initialState(c);
  turn(c, s, Math.PI); assert.equal(describe(c, s), '50% open / increased');
  turn(c, s, 100); assert.equal(s.value, 2 * Math.PI);
  turn(c, s, -100); assert.equal(s.value, 0);
});
test('HALE PRIME ignores movement, rotation, and release', () => {
  const c = spec('hale_prime'), s = initialState(c), original = structuredClone(s);
  assert.equal(move(c, s, 0.6), false); assert.equal(turn(c, s, 1), false); release(c, s);
  assert.deepEqual(s, original); assert.match(describe(c, s), /Inactive/);
});
test('actual GLB loads in Three.js; root placement survives turns and locked gestures', async () => {
  const bytes = readFileSync(new URL('../public/models/b54.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  for (const c of manifest.controls) {
    const root = gltf.scene.getObjectByName(c.node);
    assert.ok(root, c.node); assert.ok(root.children.length, `${c.node} has visible descendants`);
    const basePosition = root.position.clone(), baseQuaternion = root.quaternion.clone();
    const state = initialState(c);
    applyPose(root, c, state, basePosition, baseQuaternion);
    assert.deepEqual(root.position.toArray(), basePosition.toArray());
    if (!c.enabled || !c.lock) continue;
    move(c, state, c.positionRange[1]); applyPose(root, c, state, basePosition, baseQuaternion);
    const pulled = root.position.toArray();
    turn(c, state, 1); applyPose(root, c, state, basePosition, baseQuaternion);
    assert.deepEqual(root.position.toArray(), pulled, `${c.id}: turning cannot move handle`);
    assert.notDeepEqual(root.quaternion.toArray(), baseQuaternion.toArray(), `${c.id}: lock visibly rotates`);
    move(c, state, c.positionRange[0]); applyPose(root, c, state, basePosition, baseQuaternion);
    assert.deepEqual(root.position.toArray(), pulled, `${c.id}: locked pose stays exactly fixed`);
    turn(c, state, 0); move(c, state, c.positionRange[0]); applyPose(root, c, state, basePosition, baseQuaternion);
    const expected = basePosition.toArray().map((v, i) => v + c.positionAxis[i] * c.positionRange[0]);
    assert.deepEqual(root.position.toArray(), expected, `${c.id}: slider axis stays in parent basis`);
  }
});
test('directly rear-on pull gesture remains finite with zero projected axis length', () => {
  assert.equal(movementDelta(spec('tank_fill'), 0, -200, 0, 1), 0.6);
  assert.equal(movementDelta(spec('tank_fill'), 0, 200, 0, 1), -0.6);
  assert.equal(movementDelta(spec('foam'), 90, 0, 0, 1), 1);
});
test('keyboard suction and foam advance exactly through current manifest endpoints', () => {
  for (const id of ['suction', 'foam']) for (const scale of [1, 0.73]) {
    const c = structuredClone(spec(id));
    c.positionRange = c.positionRange.map(value => value * scale);
    c.endpoints.forEach(p => { p.value *= scale; });
    const values = c.endpoints.map(p => p.value).sort((a, b) => a - b), s = initialState(c);
    move(c, s, values[0]);
    for (const expected of values.slice(1)) {
      move(c, s, keyboardMoveTarget(c, s, 1)); release(c, s); assert.equal(s.value, expected);
    }
    for (const expected of values.slice(0, -1).reverse()) {
      move(c, s, keyboardMoveTarget(c, s, -1)); release(c, s); assert.equal(s.value, expected);
    }
    assert.equal(keyboardMoveTarget(c, s, -1), values[0]);
    if (c.lock) {
      turn(c, s, 1); move(c, s, keyboardMoveTarget(c, s, 1)); assert.equal(s.value, values[0]);
    }
  }
});
test('pump framing consumes current panel bounds and fits backing, fittings, and full pull travel', () => {
  const points = panelFraming(manifest);
  assert.equal(Math.min(...points.map(p => p.x)), manifest.rearPanel.bounds.min[0] - 0.08);
  assert.equal(Math.max(...points.map(p => p.x)), manifest.rearPanel.bounds.max[0] + 0.08);
  assert.ok(Math.max(...points.map(p => p.z)) >= manifest.rearPanel.bounds.max[2] + spec('tank_fill').positionRange[1]);
  for (const aspect of [580/550, 360/418, 1.8]) {
    const camera = new PerspectiveCamera(38, aspect, 0.05, 100);
    camera.position.fromArray(manifest.rearPanel.suggestedCamera);
    fitPerspective(camera, new Vector3(...manifest.rearPanel.center), points, 1.7);
    for (const point of points) {
      const p = point.clone().project(camera);
      assert.ok(Math.abs(p.x) <= 0.900001 && Math.abs(p.y) <= 0.900001);
    }
  }
});
test('all whole-model camera directions fit actual model geometry on desktop and narrow canvases', async () => {
  const bytes = readFileSync(new URL('../public/models/b54.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true); const points = [];
  gltf.scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox(); const b = mesh.geometry.boundingBox;
    for (const x of [b.min.x,b.max.x]) for(const y of [b.min.y,b.max.y]) for(const z of [b.min.z,b.max.z]) points.push(new Vector3(x,y,z).applyMatrix4(mesh.matrixWorld));
  });
  for (const aspect of [580/550, 360/418, 1.8]) for (const [position, target] of [[[7,4.15,8.75],[0,1.3,0]],[[-5.7,3.1,-8.5],[0,1.35,-1.3]],[[4.8,3.2,9],[0,1.4,1]]]) {
    const camera = new PerspectiveCamera(38, aspect, 0.05, 100);
    camera.position.fromArray(position); fitPerspective(camera, new Vector3(...target), points, 8);
    for (const point of points) {
      const p = point.clone().project(camera);
      assert.ok(Math.abs(p.x) <= 0.900001 && Math.abs(p.y) <= 0.900001, `aspect ${aspect}: fit inside padded viewport`);
    }
  }
});
