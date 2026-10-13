import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as units from '../src/simulation/units.js';
import { pumpHeadM, validateCurve, valveResistance, lossResistance, nozzleResistance, forwardFlowM3s } from '../src/simulation/components.js';
import { validateProfile, validateManifest, OUTLET_IDS } from '../src/simulation/config.js';
import { createControlFrame, applyControlCommand, readControlInputs } from '../src/simulation/control-inputs.js';
import { solveNetwork } from '../src/simulation/network.js';
import { createSimulationState, stepSimulation } from '../src/simulation/step.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const generic = json('../public/simulation/generic-training.json');
const b54 = json('../public/simulation/b54-incomplete.json');
const manifest = json('../public/models/b54-controls.json');
const clone = value => structuredClone(value);
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
const initialOpenings = () => ({ ...Object.fromEntries(OUTLET_IDS.map(id => [id, 0])), tank_valve: 1, tank_fill: 0, suction: 0 });
const input = (overrides = {}) => ({ openings: initialOpenings(), speedRatio: 1, tankVolumeM3: 0.5, pickupWet: true, externalAvailable: true, pumpLiquid: 'filled', ...overrides });
const scenario = (overrides = {}) => ({ id: 'test-scenario', version: '1', tankVolumeM3: 0.5, pickupWet: true, speedRatio: 1, pumpLiquid: 'filled', externalAvailable: true, ...overrides });

// Independent fixture: sole ideal reservoir, zero elevation and a total branch R
// of 3e6. These exact answers are specified in the design, not computed by the solver.
function analyticProfile(branchCount = 1) {
  const p = clone(generic);
  p.network.sources = [{ id: 'test-reservoir', kind: 'idealBoundary', from: 'external', to: 'suction', controlId: null,
    direction: 'forwardChecked', checkValve: 'assumedDemo', headM: 0 }];
  p.network.return = null;
  p.network.outlets = p.network.outlets.slice(0, branchCount).map(e => ({ ...e, termination: 'openPipe',
    loss: { type: 'quadratic', resistanceS2M5: 2000000 }, valve: { fullConductanceM3sPerSqrtM: 0.001, exponent: 1 } }));
  return p;
}
const allOpen = () => ({ ...initialOpenings(), ...Object.fromEntries(OUTLET_IDS.map(id => [id, 1])) });

test('SI/display conversions use US units, preserve signs and reject invalid quantities', () => {
  near(units.gallonsToM3(300), 1.1356235352, 1e-14);
  near(units.gpmToM3s(1), 0.0000630901964, 1e-16);
  for (const value of [0, -14.7, 0.001, 220, 300]) {
    near(units.m3ToGallons(units.gallonsToM3(value)), value);
    near(units.m3sToGpm(units.gpmToM3s(value)), value);
    near(units.paToPsi(units.psiToPa(value)), value);
    near(units.paToHead(units.headToPa(value)), value);
  }
  for (const value of [NaN, Infinity, -Infinity, '3', null]) for (const fn of [units.gallonsToM3, units.m3ToGallons, units.psiToPa, units.paToPsi, units.gpmToM3s, units.m3sToGpm, units.headToPa, units.paToHead]) assert.throws(() => fn(value));
  assert.throws(() => units.psiToPa(Number.MAX_VALUE));
});

test('B54 facts stay incomplete; generic settings and all control roots validate', () => {
  assert.equal(validateProfile(b54, { executable: false }), b54);
  assert.throws(() => validateProfile(b54), /not executable/);
  assert.equal(b54.tank.capacityM3, 1.1356235352);
  assert.deepEqual(b54.preconnectHoseClasses.map(c => c.lengthM), [30.48, 30.48]);
  assert.ok(b54.preconnectHoseClasses.every(c => c.branchIds.length === 0 && c.nozzleCurve === null));
  assert.equal(b54.boosterReel.lengthM, null);
  for (const change of [p => p.tank.capacityM3 = -1, p => p.preconnectHoseClasses[0].lengthM = 0, p => p.drive.maximumRpm = Infinity]) {
    const malformed = clone(b54); change(malformed); assert.throws(() => validateProfile(malformed, { executable: false }));
  }
  assert.equal(validateProfile(generic, { manifest }), generic);
  assert.deepEqual(generic.network.outlets.map(e => e.controlId), OUTLET_IDS);
  const calibrated = clone(generic); calibrated.profileStatus = 'b54Calibrated';
  assert.throws(() => validateProfile(calibrated), /calibration/);
});

test('profile validation rejects invalid numbers, curves, topology, provenance and unsupported policies', () => {
  const changes = [
    p => p.schemaVersion = 2, p => p.units = 'US', p => p.profileStatus = 'magic', p => p.provenance = [],
    p => p.provenance[0].status = 'measured', p => p.drive.mode = 'automatic', p => p.drive.speedBasis = 'engineRpm',
    p => p.pump.velocityHeadPolicy = 'flangeCorrection', p => p.pump.stoppedPolicy = 'unconfirmed', p => p.pump.stoppedResistanceS2M5 = 0,
    p => p.pump.curve.maxFlowM3s = 0.02, p => p.pump.curve.shutoffHeadM = NaN, p => p.pump.curve.ordinate = 'dischargePressure',
    p => p.pump.ratingPa = -1, p => p.pump.passiveMaxFlowM3s = Infinity, p => p.tank.capacityM3 = 0, p => p.tank.areaM2 = -1,
    p => p.tank.unusableVolumeM3 = 2, p => p.tank.pickupRecovery = 'instant', p => p.tank.overflowPolicy = 'clamp', p => p.tank.returnTermination = 'unknown',
    p => p.features.priming = true, p => p.network.topology = 'loop', p => p.network.outlets[0].to = 'missing',
    p => p.network.outlets[0].direction = 'bidirectional', p => p.network.outlets[0].checkValve = 'unknown',
    p => p.network.outlets[0].nozzle.diameterM = 0, p => p.network.outlets[0].nozzle.dischargeCoefficient = 2,
    p => p.network.outlets[0].valve.exponent = -1, p => p.network.outlets[0].loss.resistanceS2M5 = -1,
    p => p.network.outlets[0].termination = 'automaticNozzle', p => p.network.sources[0].kind = 'unknown',
    p => p.network.outlets[0].controlId = 'throttle', p => p.network.sources[0].controlId = 'foam', p => p.network.return.controlId = 'engine_selector',
    p => p.network.controlBindings[0].root = 'missing_root', p => p.network.controlBindings.pop(),
    p => p.network.controlBindings.push(p.network.controlBindings[0]), p => p.network.outlets[1].controlId = p.network.outlets[0].controlId,
    p => p.network.sources.push(clone(p.network.sources[0])), p => p.solver.iterations = 1000, p => p.solver.fixedStepS = 0,
    p => p.solver.minSuctionHeadM = -Infinity,
  ];
  for (const change of changes) { const p = clone(generic); change(p); assert.throws(() => validateProfile(p, { manifest }), change.toString()); }
  const m = clone(manifest); m.controls[0].positionRange = [0, 0]; assert.throws(() => validateManifest(m));
  const m2 = clone(manifest); m2.controls[0].node = m2.controls[1].node; assert.throws(() => validateManifest(m2));
});

test('components implement losses, orifice conversion, zero closure and partial conductance', () => {
  // Independent unit velocity fixture: D chosen for area 1m2, v=2m/s.
  const d = Math.sqrt(4 / Math.PI);
  const r = lossResistance({ type: 'darcy', internalDiameterM: d, lengthM: 10 * d, darcyFrictionFactor: 0.02, fittingsK: 0.8 });
  near(r * 4, 4 / (2 * units.GRAVITY_M_S2));
  near(nozzleResistance({ type: 'fixedOrifice', diameterM: d, dischargeCoefficient: 1 }), 1 / (2 * units.GRAVITY_M_S2));
  const valve = { fullConductanceM3sPerSqrtM: 0.001, exponent: 1 };
  assert.equal(valveResistance(valve, 0), null);
  near(forwardFlowM3s(100, valveResistance(valve, 0.5)), 0.005);
  near(forwardFlowM3s(100, valveResistance(valve, 1)), 0.01);
  assert.equal(forwardFlowM3s(-100, 1000000), 0);
  assert.throws(() => lossResistance({ type: 'darcy', internalDiameterM: 0 }));
  assert.throws(() => nozzleResistance({ type: 'automatic' }));
});

test('curve affinity and interpolation cover legal scaled endpoints without extrapolation', () => {
  const curve = { type: 'table', speedBasis: 'normalized-reference', ordinate: 'totalHeadM', maxFlowM3s: 0.0123,
    points: [{ flowM3s: 0, headM: 100 }, { flowM3s: 0.00615, headM: 70 }, { flowM3s: 0.0123, headM: 0 }] };
  near(pumpHeadM(curve, 0.003075, 1), 85);
  near(pumpHeadM(curve, 0.003075, 0.5), 17.5);
  for (const maxFlow of [0.00017, 0.0027, 0.0123, 0.0317, 0.123]) for (let i = 1; i <= 100; i++) {
    const c = { ...curve, maxFlowM3s: maxFlow, points: [{ flowM3s: 0, headM: 100 }, { flowM3s: maxFlow, headM: 0 }] };
    const speed = i / 100;
    near(pumpHeadM(c, maxFlow * speed, speed), 0, 1e-12);
    assert.throws(() => pumpHeadM(c, maxFlow * speed * 1.000001, speed), /domain/);
  }
  for (const change of [c => c.points[1].flowM3s = 0, c => c.points[1].headM = 101, c => c.points[0].flowM3s = 1e-5, c => c.points[2].headM = NaN]) {
    const c = clone(curve); change(c); assert.throws(() => validateCurve(c));
  }
  assert.throws(() => pumpHeadM(curve, 0, 0), /passive/);
});

test('analytic one branch, two branches and half speed meet independently specified answers', () => {
  const single = solveNetwork(analyticProfile(), input({ openings: allOpen() }));
  assert.equal(single.ok, true); near(single.pumpFlowM3s, 0.005); near(single.dischargeHeadM, 75, 1e-7);
  const parallel = solveNetwork(analyticProfile(2), input({ openings: allOpen() }));
  assert.equal(parallel.ok, true); near(parallel.pumpFlowM3s, 0.007559289460184544); near(parallel.dischargeHeadM, 42.85714285714286, 1e-7);
  near(parallel.flows.outletsM3s.hose_reel, parallel.flows.outletsM3s.right_preconnect);
  assert.ok(parallel.flows.outletsM3s.hose_reel < single.flows.outletsM3s.hose_reel);
  const half = solveNetwork(analyticProfile(), input({ openings: allOpen(), speedRatio: 0.5 }));
  near(half.pumpFlowM3s, 0.0025); near(half.dischargeHeadM, 18.75, 1e-7);
  for (const r of [single, parallel, half]) {
    assert.ok(Math.abs(r.residuals.suctionM3s) < 1e-9); assert.ok(Math.abs(r.residuals.dischargeM3s) < 1e-9);
  }
});

test('deadhead, closed charged nozzle, cap and isolated line pressures are distinct', () => {
  const p = analyticProfile(); p.network.outlets[0].termination = 'closedNozzle';
  const r = solveNetwork(p, input({ openings: allOpen() }));
  assert.equal(r.status, 'deadhead'); assert.equal(r.pumpFlowM3s, 0); assert.equal(r.dischargeHeadM, 100);
  assert.equal(r.lines.hose_reel.status, 'connectedStatic'); assert.equal(r.lines.hose_reel.headM, 100);
  p.network.outlets[0].termination = 'cap'; assert.equal(solveNetwork(p, input({ openings: allOpen() })).pumpFlowM3s, 0);
  const isolated = solveNetwork(p, input()); assert.equal(isolated.lines.hose_reel.status, 'isolated'); assert.equal(isolated.lines.hose_reel.headM, null);
});

test('passive stopped pump preserves external pressure; closed stopped policy isolates discharge', () => {
  const p = analyticProfile(); p.network.sources[0].headM = 20;
  p.network.outlets[0].loss.resistanceS2M5 = 0; p.pump.stoppedResistanceS2M5 = 1000000;
  const r = solveNetwork(p, input({ speedRatio: 0, openings: allOpen() }));
  assert.equal(r.status, 'passive'); near(r.pumpFlowM3s, 0.0031622776601683794); near(r.dischargeHeadM, 10, 1e-7);
  p.pump.stoppedPolicy = 'closed'; const closed = solveNetwork(p, input({ speedRatio: 0, openings: allOpen() }));
  assert.equal(closed.status, 'stoppedIsolated'); assert.equal(closed.pumpFlowM3s, 0); assert.equal(closed.dischargeHeadM, null);
  p.pump.stoppedPolicy = 'passiveResistance';
  assert.equal(solveNetwork(p, input({ speedRatio: 0 })).status, 'stoppedStatic');
});

test('table curve, Darcy outlet and atmospheric return are supported profile modes', () => {
  const p = analyticProfile();
  p.pump.curve = { type: 'table', speedBasis: 'normalized-reference', ordinate: 'totalHeadM', maxFlowM3s: 0.01,
    points: [{ flowM3s: 0, headM: 100 }, { flowM3s: 0.01, headM: 0 }] };
  // 100 - 10000Q = 3e6 Q² => positive root (-1 + sqrt(13))/600.
  const r = solveNetwork(p, input({ openings: allOpen() }));
  near(r.pumpFlowM3s, (Math.sqrt(13) - 1) / 600);
  p.network.outlets[0].loss = { type: 'darcy', internalDiameterM: 0.04, lengthM: 25, darcyFrictionFactor: 0.02, fittingsK: 1 };
  assert.equal(solveNetwork(p, input({ openings: allOpen() })).ok, true);
  const a = clone(generic); a.tank.returnTermination = 'atmospheric'; a.tank.returnElevationM = 5;
  const returned = solveNetwork(a, input({ openings: { ...initialOpenings(), tank_fill: 1 } }));
  assert.ok(returned.flows.returnM3s > 0); near(returned.flows.returnM3s, returned.flows.tankOutM3s);
});

test('failure statuses are explicit, bounded, and contain no reusable flows; rating is not a clamp', () => {
  const p = analyticProfile();
  const limited = clone(p); limited.pump.curve.maxFlowM3s = 0.001;
  assert.equal(solveNetwork(limited, input({ openings: allOpen() })).status, 'curveDomain');
  assert.equal(solveNetwork(generic, input({ openings: { ...initialOpenings(), tank_valve: 0 } })).status, 'noSupply');
  const supplyLimit = clone(generic); supplyLimit.solver.minSuctionHeadM = 0.499999;
  assert.equal(solveNetwork(supplyLimit, input({ openings: allOpen() })).status, 'sourceDomain');
  for (const overrides of [{ speedRatio: NaN }, { speedRatio: 2 }, { openings: {} }, { tankVolumeM3: -1 }, { pumpLiquid: 'unconfirmed' }]) {
    const r = solveNetwork(p, input(overrides)); assert.equal(r.status, 'invalidInput'); assert.equal(r.flows, null);
  }
  assert.equal(solveNetwork(p, input({ pumpLiquid: 'dry' })).status, 'unprimed');
  p.pump.curve.shutoffHeadM = 200; p.pump.ratingPa = units.psiToPa(220);
  const rating = solveNetwork(p, input()); assert.equal(rating.dischargeHeadM, 200); assert.deepEqual(rating.events, ['dischargeRatingExceeded']);
});

test('adapter is manifest-based, pure, reverse mapped, and locks exactly across commands', () => {
  const m = clone(manifest);
  for (const c of m.controls.filter(c => c.type === 'pushPullLock')) { c.positionRange = [0.1, 0.91]; c.neutral = 0.1; c.endpoints = [{ value: 0.1 }, { value: 0.91 }]; }
  let frame = createControlFrame(m), before = clone(frame);
  assert.equal(frame.inputs.openings.tank_valve, 1);
  const command = (id, type, value) => { frame = applyControlCommand(m, frame, { id, type, value }); };
  for (const id of [...OUTLET_IDS, 'tank_fill', 'tank_valve']) {
    command(id, 'move', 0.373125); const expected = frame.states[id].value, opening = frame.inputs.openings[id];
    command(id, 'turn', 1); assert.equal(frame.inputs.openings[id], opening);
    for (const action of [{ type: 'move', value: 0.91 }, { type: 'endpoint', value: 0.1 }, { type: 'keyboard', direction: 1 }, { type: 'release' }]) {
      frame = applyControlCommand(m, frame, { id, ...action });
      assert.equal(frame.states[id].value, expected); assert.equal(frame.inputs.openings[id], opening);
    }
    command(id, 'turn', 0); command(id, 'endpoint', 0.91);
    assert.equal(frame.inputs.openings[id], id === 'tank_valve' ? 0 : 1);
  }
  assert.deepEqual(before, createControlFrame(m));
  const snapshot = clone(frame); readControlInputs(m, frame.states, frame.inputs.committedDetents); assert.deepEqual(frame, snapshot);
});

test('discrete commands commit only on accepted release/endpoint, retain locked foam and persistent START', () => {
  let f = createControlFrame(manifest);
  const apply = (id, type, value) => { f = applyControlCommand(manifest, f, { id, type, value }); };
  const suctionEnd = manifest.controls.find(c => c.id === 'suction').positionRange[1];
  apply('suction', 'move', suctionEnd); assert.equal(f.inputs.openings.suction, 0);
  apply('suction', 'release'); assert.equal(f.inputs.openings.suction, 1);
  apply('suction', 'move', suctionEnd * 0.4); assert.equal(f.inputs.openings.suction, 1);
  apply('suction', 'release'); assert.equal(f.inputs.openings.suction, 0);
  apply('foam', 'move', 0.02); apply('foam', 'turn', 1); const foamPosition = f.states.foam.value;
  apply('foam', 'release'); assert.equal(f.inputs.foamMode, 'OFF'); assert.equal(f.states.foam.value, foamPosition);
  apply('engine_selector', 'endpoint', -0.65);
  for (let i = 0; i < 10; i++) apply('engine_selector', 'release');
  assert.equal(f.inputs.engineRequest, 'START'); assert.equal(f.states.engine_selector.value, -0.65);
  const previous = clone(f.states.hale_prime); apply('hale_prime', 'move', 0.6); assert.deepEqual(f.states.hale_prime, previous);
  assert.equal(f.inputs.waterPrimer, 'inactive');
  const states = clone(f.states); states.foam.value = 0.01; states.foam.locked = true;
  assert.equal(createControlFrame(manifest, states).inputs.foamMode, null);
  apply('throttle', 'turn', Math.PI); assert.equal(f.inputs.speedDemand, 0.5);
});

test('locked opening stays exact under hydraulic load changes and equivalent event paths', () => {
  let frame = createControlFrame(manifest);
  frame = applyControlCommand(manifest, frame, { id: 'hose_reel', type: 'move', value: 0.21731 });
  frame = applyControlCommand(manifest, frame, { id: 'hose_reel', type: 'turn', value: 1 });
  const lockedValue = frame.states.hose_reel.value, lockedOpening = frame.inputs.openings.hose_reel;
  const first = solveNetwork(generic, input({ openings: frame.inputs.openings }));
  frame = applyControlCommand(manifest, frame, { id: 'right_preconnect', type: 'endpoint', value: 0.6 });
  const second = solveNetwork(generic, input({ openings: frame.inputs.openings }));
  assert.ok(first.ok && second.ok); assert.ok(second.dischargeHeadM < first.dischargeHeadM);
  assert.ok(second.flows.outletsM3s.hose_reel < first.flows.outletsM3s.hose_reel);
  assert.equal(frame.states.hose_reel.value, lockedValue); assert.equal(frame.inputs.openings.hose_reel, lockedOpening);
  const end = manifest.controls.find(c => c.id === 'suction').positionRange[1];
  const initial = createControlFrame(manifest);
  const endpoint = applyControlCommand(manifest, initial, { id: 'suction', type: 'endpoint', value: end });
  const keyboard = applyControlCommand(manifest, initial, { id: 'suction', type: 'keyboard', direction: 1 });
  const drag = applyControlCommand(manifest, applyControlCommand(manifest, initial, { id: 'suction', type: 'move', value: end }), { id: 'suction', type: 'release' });
  assert.deepEqual(endpoint.inputs, keyboard.inputs); assert.deepEqual(endpoint.inputs, drag.inputs);
});

test('bounded deterministic input sweep has finite successful outputs and manifold conservation', () => {
  let seed = 4519;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  let successful = 0, failed = 0;
  function checkFinite(value) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
    else if (value && typeof value === 'object') Object.values(value).forEach(checkFinite);
  }
  for (let i = 0; i < 200; i++) {
    const openings = Object.fromEntries([...OUTLET_IDS, 'tank_valve', 'tank_fill'].map(id => [id, random()]));
    openings.suction = i % 2;
    const r = solveNetwork(generic, input({ openings, speedRatio: i % 10 === 0 ? 0 : random(), tankVolumeM3: random() }));
    checkFinite(r);
    if (r.ok) {
      successful++;
      assert.ok(r.pumpFlowM3s >= 0); assert.ok(r.flows.deliveredM3s >= 0);
      near(r.pumpFlowM3s, r.flows.tankOutM3s + r.flows.externalIntakeM3s, 1e-8);
      near(r.pumpFlowM3s, r.flows.deliveredM3s + r.flows.returnM3s, 1e-8);
    } else { failed++; assert.equal(r.flows, null); assert.ok(['sourceDomain', 'curveDomain'].includes(r.status), r.message); }
  }
  assert.ok(successful > 30); assert.ok(failed > 0);
});

test('recirculation conserves water; added nozzle drains only delivered volume over ten minutes', () => {
  let state = createSimulationState(generic, scenario());
  const returnOnly = { openings: { ...initialOpenings(), tank_fill: 1 } };
  for (let i = 0; i < 100; i++) state = stepSimulation(generic, state, returnOnly);
  near(state.tankVolumeM3, 0.5, 1e-10); assert.ok(state.cumulative.returnM3 > 0); assert.equal(state.cumulative.deliveredM3, 0);
  const nozzle = { openings: { ...returnOnly.openings, hose_reel: 0.1 } };
  for (let i = 0; i < 30000; i++) state = stepSimulation(generic, state, nozzle);
  assert.equal(state.tick, 30100); assert.ok(state.cumulative.deliveredM3 > 0);
  near(0.5 - state.tankVolumeM3, state.cumulative.deliveredM3, 1e-8);
  assert.ok(Math.abs(state.massBalanceErrorM3) / Math.max(0.001, state.initialTankVolumeM3 + state.cumulative.externalIntakeM3) < 0.0001);
});

test('depletion splits a final partial tick, stops at pickup boundary and never reuses stale flow', () => {
  const p = clone(generic); p.solver.fixedStepS = 1;
  let state = createSimulationState(p, scenario({ tankVolumeM3: 0.00001 }));
  state = stepSimulation(p, state, { openings: allOpen() });
  assert.equal(state.tankVolumeM3, 0); assert.equal(state.pickupWet, false); assert.ok(state.events.includes('pickupDry'));
  assert.equal(state.lastSolve.status, 'noSupply'); near(state.cumulative.deliveredM3, 0.00001, 1e-10);
  const delivered = state.cumulative.deliveredM3;
  state = stepSimulation(p, state, { openings: allOpen() }); assert.equal(state.cumulative.deliveredM3, delivered);
  const u = clone(p); u.tank.unusableVolumeM3 = 0.1;
  const unusable = stepSimulation(u, createSimulationState(u, scenario({ tankVolumeM3: 0.10001 })), { openings: allOpen() });
  assert.equal(unusable.tankVolumeM3, 0.1); near(unusable.cumulative.deliveredM3, 0.00001, 1e-10);
});

test('full tank recirculates; external intake and overflow have separate conserved ledgers', () => {
  const p = clone(generic); p.solver.fixedStepS = 1;
  const full = createSimulationState(p, scenario({ tankVolumeM3: 1 }));
  const recirc = stepSimulation(p, full, { openings: { ...initialOpenings(), tank_fill: 1 } });
  near(recirc.tankVolumeM3, 1, 1e-12); near(recirc.cumulative.overflowM3, 0, 1e-12); assert.ok(recirc.cumulative.returnM3 > 0);
  const fillCommands = { openings: { ...initialOpenings(), tank_valve: 0, suction: 1, tank_fill: 1 } };
  const nearFull = createSimulationState(p, scenario({ tankVolumeM3: 0.999999 }));
  const filled = stepSimulation(p, nearFull, fillCommands);
  assert.equal(filled.tankVolumeM3, 1); assert.ok(filled.events.includes('tankFull')); assert.ok(filled.cumulative.overflowM3 > 0);
  near(filled.cumulative.externalIntakeM3, filled.cumulative.overflowM3 + 0.000001, 1e-9);
  near(filled.massBalanceErrorM3, 0, 1e-9); assert.equal(filled.cumulative.directFillM3, 0);
  const dry = createSimulationState(p, scenario({ tankVolumeM3: 0, pickupWet: false }));
  const refilled = stepSimulation(p, dry, fillCommands);
  assert.ok(refilled.tankVolumeM3 > 0); assert.equal(refilled.pickupWet, false);
  const tankOnly = stepSimulation(p, refilled, { openings: allOpen() }); assert.equal(tankOnly.lastSolve.status, 'noSupply');
});

test('simultaneous finite checked sources obey both manifold and global continuity', () => {
  const p = clone(generic); p.network.sources[1].headM = 0.5;
  const commands = { openings: { ...allOpen(), suction: 1, tank_fill: 0.4 } };
  const state = stepSimulation(p, createSimulationState(p, scenario()), commands);
  assert.equal(state.tick, 1);
  assert.ok(state.cumulative.tankOutM3 > 0); assert.ok(state.cumulative.externalIntakeM3 > 0);
  near(state.massBalanceErrorM3, 0, 1e-9);
  const result = state.lastSolve;
  near(result.pumpFlowM3s, result.flows.tankOutM3s + result.flows.externalIntakeM3s);
  near(result.pumpFlowM3s, result.flows.returnM3s + result.flows.deliveredM3s);
});

test('failed solves suspend whole ticks; state and commands are immutable; deterministic replay', () => {
  const p = analyticProfile(); p.pump.curve.maxFlowM3s = 0.001;
  const state = createSimulationState(p, scenario()), commands = { openings: allOpen() };
  const before = clone({ p, state, commands }); const failed = stepSimulation(p, state, commands);
  assert.equal(failed.tick, 0); assert.equal(failed.timeS, 0); assert.equal(failed.tankVolumeM3, state.tankVolumeM3);
  assert.deepEqual(failed.cumulative, state.cumulative); assert.equal(failed.lastSolve.flows, null);
  assert.deepEqual({ p, state, commands }, before);
  function replay(batchSize) {
    let s = createSimulationState(generic, scenario());
    const trace = [];
    for (let render = 0; render < 300; render += batchSize) for (let k = render; k < Math.min(render + batchSize, 300); k++) {
      s = stepSimulation(generic, s, { speedRatio: k < 80 ? 0.5 : 1, openings: { ...initialOpenings(), hose_reel: 0.25, tank_fill: k >= 150 ? 0.5 : 0 } });
      assert.equal(s.tick, k + 1);
      trace.push(s);
    }
    return trace;
  }
  assert.deepEqual(replay(1), replay(3)); assert.deepEqual(replay(1), replay(5));
  const dry = createSimulationState(generic, scenario({ pumpLiquid: 'dry' }));
  const unprimed = stepSimulation(generic, dry, { openings: allOpen() });
  assert.equal(unprimed.tick, 1); assert.equal(unprimed.pumpLiquid, 'dry'); assert.equal(unprimed.cumulative.deliveredM3, 0);
  const consumed = stepSimulation(generic, createSimulationState(generic, scenario()), { openings: allOpen() });
  const resetControls = createControlFrame(manifest);
  const reset = stepSimulation(generic, consumed, { openings: resetControls.inputs.openings });
  near(reset.tankVolumeM3, consumed.tankVolumeM3); assert.ok(reset.tankVolumeM3 < 0.5);
  assert.equal(createSimulationState(generic, scenario()).tankVolumeM3, 0.5);
});
