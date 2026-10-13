import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Matrix4, Quaternion, Vector3 } from 'three';
const path = new URL('../public/models/', import.meta.url);
const buffer = fs.readFileSync(new URL('b54.glb', path));
assert.equal(buffer.readUInt32LE(0), 0x46546c67, 'GLB header');
assert.equal(buffer.readUInt32LE(4), 2, 'glTF version');
assert.equal(buffer.readUInt32LE(8), buffer.length, 'GLB complete length');
const gltf = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
const manifest = JSON.parse(fs.readFileSync(new URL('b54-controls.json', path)));
assert.equal(manifest.controls.length, 13);
assert.equal(gltf.nodes.filter(n => n.name?.startsWith('ctrl_')).length, 13);
assert.equal(gltf.images?.length ?? 0, 0, 'No photos or raster textures embedded');
let triangles = 0;
for (const mesh of gltf.meshes) for (const p of mesh.primitives) {
  assert.ok(gltf.accessors[p.attributes.POSITION].count > 0);
  triangles += gltf.accessors[p.indices].count / 3;
}
for (const c of manifest.controls) {
  const n = gltf.nodes.find(n => n.name === c.node);
  assert.ok(n, `${c.id} node exists`);
  assert.ok(n.children.length, `${c.id} has its own visible children`);
  assert.deepEqual(n.rotation ?? [0, 0, 0, 1], [0, 0, 0, 1], `${c.id} rotation`);
  assert.deepEqual(n.scale ?? [1, 1, 1], [1, 1, 1], `${c.id} scale`);
  assert.equal(n.extras.controlId, c.id);
  assert.equal(n.extras.interactive, c.enabled);
  const range = c.positionRange ?? c.rotationRange;
  if (c.endpoints) for (const e of c.endpoints) assert.ok(e.value >= range[0] && e.value <= range[1], `${c.id} endpoint in range`);
  if (c.positionAxis) assert.ok(c.positionAxis.every(Number.isFinite));
}
assert.equal(manifest.controls.find(c => c.id === 'hale_prime').enabled, false);
assert.equal(manifest.controls.find(c => c.id === 'engine_selector').springReturn, false);
assert.equal(manifest.controls.find(c => c.id === 'tank_valve').endpoints[1].state, 'closed');
assert.equal(manifest.controls.filter(c => c.enabled).length, 12);
const meshDimensions = name => {
  const n = gltf.nodes.find(n => n.name === name);
  assert.ok(n, `${name} exists`);
  const a = gltf.accessors[gltf.meshes[n.mesh].primitives[0].attributes.POSITION];
  return a.max.map((v, i) => (v - a.min[i]) * (n.scale?.[i] ?? 1));
};
const rootMeshBounds = name => {
  const n = gltf.nodes.find(n => n.name === name);
  const a = gltf.accessors[gltf.meshes[n.mesh].primitives[0].attributes.POSITION];
  assert.ok(!n.rotation && !n.matrix, `${name} simple world-aligned root`);
  return { min: a.min.map((v, i) => v + (n.translation?.[i] ?? 0)), max: a.max.map((v, i) => v + (n.translation?.[i] ?? 0)) };
};
const actualBacking = rootMeshBounds('Rear panel backing');
const actualDeck = rootMeshBounds('Walkway deck');
const actualRightTower = rootMeshBounds('Rear red compartment tower.001');
const hoseDeck = rootMeshBounds(manifest.hoseBeds.deckNode);
const pumpHousing = rootMeshBounds('Pump housing');
assert.equal(manifest.hoseBeds.laneCount, 3);
assert.equal(manifest.hoseBeds.dividerNodes.length, 4);
const hoseDividers = manifest.hoseBeds.dividerNodes.map(rootMeshBounds);
assert.ok(Math.abs(hoseDeck.min[0] - actualBacking.min[0]) < 1e-5, 'Hose deck reaches pump left edge');
assert.ok(Math.abs(hoseDeck.max[0] - actualBacking.max[0]) < 1e-5, 'Hose deck reaches pump right edge');
assert.ok(Math.abs(hoseDividers[0].min[0] - hoseDeck.min[0]) < 1e-5, 'No unintended left gap beside hose lanes');
assert.ok(Math.abs(hoseDividers[3].max[0] - hoseDeck.max[0]) < 1e-5, 'Lanes reach full right edge without entering walkway');
assert.ok(Math.abs(pumpHousing.min[0] - hoseDividers[0].min[0] - .0125) < 1e-5 && Math.abs(hoseDividers[3].max[0] - pumpHousing.max[0] - .0125) < 1e-5, 'Outer bed rims track actual housing sides with 12.5 mm backing trim');
assert.ok(hoseDeck.max[0] <= actualDeck.min[0] + 1e-5);
for (const lane of manifest.hoseBeds.lanes) {
  const stacks = gltf.nodes.filter(n => n.name.startsWith(`Hose lane ${lane.index} canvas`));
  assert.equal(stacks.length, 12, `Lane ${lane.index} remains a distinct complete hose stack`);
  const left = hoseDividers[lane.index - 1].max[0], right = hoseDividers[lane.index].min[0];
  for (const stack of stacks) {
    const b = rootMeshBounds(stack.name);
    assert.ok(b.min[0] > left && b.max[0] < right, `${stack.name} fits its lane`);
    assert.ok(b.min[0] - left < .012 && right - b.max[0] < .012, `${stack.name} fills the widened lane`);
  }
}
for (let i = 0; i < 3; i++) {
  assert.ok(Math.abs(actualBacking.min[i] - manifest.rearPanel.bounds.min[i]) < 1e-5);
  assert.ok(Math.abs(actualBacking.max[i] - manifest.rearPanel.bounds.max[i]) < 1e-5);
}
assert.ok(Math.abs(actualBacking.max[2] - rootMeshBounds('Rear tower end red face').max[2]) < 1e-5, 'Actual face and rear toolbox ends are flush');
assert.ok(Math.abs(actualBacking.max[0] - actualDeck.min[0]) < 1e-5, 'Deck begins beside actual pump right edge');
assert.ok(Math.abs(actualDeck.max[0] - actualRightTower.min[0]) < 1e-5, 'Walkway separates actual pump and right red toolbox');
assert.ok(rootMeshBounds('Pump housing').max[2] < actualBacking.max[2] - .02, 'Housing and panel faces are not coincident');
assert.ok(Math.abs(meshDimensions('Rear panel backing')[0] - manifest.rearPanel.width) < 1e-5);
assert.ok(Math.abs(rootMeshBounds('Right compartment body').max[0] - rootMeshBounds('Bed upper body').min[0] - 2.16) < 1e-5, 'Outer body width unchanged while center is opened');
assert.ok(Math.abs(meshDimensions('Rear step')[0] - 2.25) < 1e-5, 'Bumper width unchanged');
for (const n of gltf.nodes.filter(n => /^(Intake|Pressure|Tachometer|Discharge pressure)_face/.test(n.name))) {
  const d = meshDimensions(n.name);
  assert.ok(Math.abs(d[0] - d[1]) < 1e-5, `${n.name} remains circular`);
}
assert.ok(Math.abs(manifest.rearPanel.bounds.min[0] - (manifest.rearPanel.center[0] - manifest.rearPanel.width / 2)) < 1e-6);
assert.ok(Math.abs(meshDimensions('Rear panel backing')[1] - manifest.rearPanel.height) < 1e-5);
assert.ok(Math.abs(meshDimensions('Walkway deck')[0] - manifest.rearBay.openingWidth) < 1e-5);
assert.ok(Math.abs(meshDimensions('Walkway deck')[2] - manifest.rearBay.deckDepth) < 1e-5);
const actualToolbox = rootMeshBounds(manifest.rearBay.toolboxNode);
assert.ok(actualDeck.min[2] <= actualToolbox.min[2] + 1e-5 && actualDeck.max[2] >= actualToolbox.max[2] - 1e-5, 'Deck covers full silver toolbox length');
assert.ok(Math.abs(actualDeck.min[2] - actualToolbox.min[2]) < 1e-5, 'Deck reaches toolbox front');
assert.ok(manifest.rearBay.deckDepth > 3, 'Full-length deck, not short rear pocket');
assert.ok(Math.abs(rootMeshBounds('Right containers inner wall').min[2] - actualToolbox.min[2]) < 1e-5, 'Passage wall reaches toolbox front');
assert.ok(rootMeshBounds('Bed floor').max[1] < manifest.rearBay.deckHeight, 'Underfloor no longer obstructs deck');
// Check every exported mesh against an interior passage volume, excluding only
// narrow wall/threshold margins and the shallow diamond-plate tread relief.
const parents = new Map();
gltf.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parents.set(c, i)));
const worldMatrix = index => {
  const n = gltf.nodes[index];
  const local = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(new Vector3(...(n.translation ?? [0, 0, 0])), new Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new Vector3(...(n.scale ?? [1, 1, 1])));
  return parents.has(index) ? worldMatrix(parents.get(index)).multiply(local) : local;
};
const pathMin = [actualDeck.min[0] + .03, manifest.rearBay.deckHeight + .02, actualDeck.min[2] + .06];
const pathMax = [actualDeck.max[0] - .03, 2.42, actualDeck.max[2] - .06];
for (let index = 0; index < gltf.nodes.length; index++) {
  const n = gltf.nodes[index];
  if (n.mesh === undefined) continue;
  const matrix = worldMatrix(index);
  for (const p of gltf.meshes[n.mesh].primitives) {
    const a = gltf.accessors[p.attributes.POSITION];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let bits = 0; bits < 8; bits++) {
      const v = new Vector3(...a.min.map((m, i) => bits & (1 << i) ? a.max[i] : m)).applyMatrix4(matrix).toArray();
      v.forEach((value, i) => { min[i] = Math.min(min[i], value); max[i] = Math.max(max[i], value); });
    }
    assert.ok(!min.every((v, i) => v < pathMax[i] && max[i] > pathMin[i]), `${n.name} obstructs full-length walkway interior`);
  }
}
assert.equal(manifest.rearBay.rearPlaneZ, manifest.rearBay.pumpFaceZ, 'Pump face is flush, not recessed');
assert.equal(manifest.rearBay.bounds.min[0], manifest.rearPanel.bounds.max[0], 'Walkway begins at right edge of pump');
assert.ok(manifest.rearBay.centerX > manifest.rearPanel.center[0], 'Walkway is on right');
assert.ok(manifest.rearPanel.bounds.max[2] === manifest.rearBay.pumpFaceZ);
assert.ok(gltf.nodes.some(n => n.name === 'Rear red compartment tower'));
assert.ok(gltf.nodes.some(n => n.name === 'Right containers inner wall'));
assert.ok(gltf.nodes.some(n => n.name === 'Pump right side wall'));
assert.ok(!gltf.nodes.some(n => n.name === 'Bay inner metal wall'), 'No obsolete centered cavity');
for (const c of manifest.controls) {
  const n = gltf.nodes.find(n => n.name === c.node);
  assert.ok(n.translation[0] > manifest.rearPanel.bounds.min[0] && n.translation[0] < manifest.rearPanel.bounds.max[0]);
  assert.ok(n.translation[1] > manifest.rearPanel.bounds.min[1] && n.translation[1] < manifest.rearPanel.bounds.max[1]);
  assert.ok(n.translation[2] > manifest.rearBay.pumpFaceZ, `${c.id} projects from flush face`);
}
for (const c of manifest.controls.filter(c => c.type === 'pushPullLock')) assert.equal(c.positionRange[1], .6, 'Axial stroke unchanged');
// Confirm fully extended grips project beyond the flush rear face truthfully.
const subtreeMaxZ = (index, parent = new Matrix4()) => {
  const n = gltf.nodes[index];
  const local = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(new Vector3(...(n.translation ?? [0, 0, 0])), new Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new Vector3(...(n.scale ?? [1, 1, 1])));
  const world = parent.clone().multiply(local);
  let maximum = -Infinity;
  if (n.mesh !== undefined) for (const p of gltf.meshes[n.mesh].primitives) {
    const a = gltf.accessors[p.attributes.POSITION];
    for (let bits = 0; bits < 8; bits++) {
      const v = new Vector3(...a.min.map((m, i) => bits & (1 << i) ? a.max[i] : m)).applyMatrix4(world);
      maximum = Math.max(maximum, v.z);
    }
  }
  for (const child of n.children ?? []) maximum = Math.max(maximum, subtreeMaxZ(child, world));
  return maximum;
};
for (const c of manifest.controls.filter(c => c.type === 'pushPullLock')) {
  const maxZ = subtreeMaxZ(gltf.nodes.findIndex(n => n.name === c.node)) + c.positionRange[1];
  assert.ok(maxZ > manifest.rearBay.rearPlaneZ + .6, `${c.id} extended grip projects beyond rear face`);
}
assert.deepEqual(manifest.boosterReel.payoutDirection, [-1, 0, 0]);
assert.deepEqual(manifest.boosterReel.spoolAxis, [0, 0, 1]);
const hub = meshDimensions('Reel hub');
assert.ok(hub[2] > hub[0] * 3 && hub[2] > hub[1] * 3, 'Complete reel spindle runs fore/aft');
const flanges = gltf.nodes.filter(n => /^Hose reel flange/.test(n.name));
assert.equal(flanges.length, 2);
assert.ok(Math.abs(flanges[0].translation[0] - flanges[1].translation[0]) < 1e-5);
assert.ok(Math.abs(flanges[0].translation[2] - flanges[1].translation[2]) > .69);
assert.ok(gltf.nodes.some(n => n.name === manifest.boosterReel.routingNode));
assert.ok(buffer.length < 15_000_000);
console.log(JSON.stringify({ bytes: buffer.length, nodes: gltf.nodes.length, meshes: gltf.meshes.length, triangles, controls: manifest.controls.length, result: 'passed' }, null, 2));
