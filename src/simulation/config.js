import { bounded, finite } from './units.js';
import { positive, validateCurve, lossResistance, nozzleResistance, valveResistance } from './components.js';

export const OUTLET_IDS = ['hose_reel', 'right_preconnect', 'discharge_1', 'center_preconnect', 'discharge_2_5', 'left_preconnect'];
export const CONTROL_IDS = ['tank_fill', ...OUTLET_IDS, 'tank_valve', 'suction', 'foam', 'throttle', 'engine_selector'];
const evidenceStatuses = ['photoConfirmed', 'manufacturerFamily', 'truckConfirmed', 'measured', 'assumedDemo', 'unknown'];
const requireText = (v, name) => { if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} is required`); };

function validateKnownRecord(p) {
  const known = (value, check, name) => { if (value !== null && value !== undefined) check(value, name); };
  const nonnegative = (value, name) => bounded(value, 0, Number.MAX_VALUE, name);
  known(p.identity?.nameplateMaxDischargePsig, positive, 'nameplate rating');
  known(p.tank?.capacityM3, positive, 'tank capacity');
  known(p.tank?.unusableVolumeM3, nonnegative, 'unusable volume');
  if (p.tank?.capacityM3 != null && p.tank?.unusableVolumeM3 != null && p.tank.unusableVolumeM3 >= p.tank.capacityM3) throw new Error('Tank requires usable volume');
  known(p.tank?.outletElevationM, finite, 'tank outlet elevation');
  for (const name of ['idleRpm', 'maximumRpm', 'pumpToEngineSpeedRatio']) known(p.drive?.[name], positive, name);
  if (p.drive?.idleRpm != null && p.drive?.maximumRpm != null && p.drive.idleRpm > p.drive.maximumRpm) throw new Error('Invalid known speed range');
  for (const hose of [...(p.preconnectHoseClasses ?? []), ...(p.boosterReel ? [p.boosterReel] : [])]) {
    for (const name of ['lengthM', 'nominalDiameterM', 'internalDiameterM']) known(hose[name], positive, name);
    if (hose.branchIds !== undefined && (!Array.isArray(hose.branchIds) || hose.branchIds.some(id => !OUTLET_IDS.includes(id)))) throw new Error('Invalid known hose branch');
  }
  if (p.pump?.curve != null) validateCurve(p.pump.curve);
  // Unknown numerical fields remain null. Nonfinite numbers are never valid facts.
  function scan(value) {
    if (typeof value === 'number') finite(value, 'record number');
    else if (value && typeof value === 'object') Object.values(value).forEach(scan);
  }
  scan(p);
}

export function validateManifest(manifest) {
  if (!Array.isArray(manifest?.controls)) throw new Error('Missing control manifest');
  const ids = new Set(), roots = new Set();
  for (const c of manifest.controls) {
    requireText(c.id, 'control id'); requireText(c.node, 'control root');
    if (ids.has(c.id) || roots.has(c.node)) throw new Error('Duplicate control id/root');
    ids.add(c.id); roots.add(c.node);
    if (c.enabled) {
      const range = c.positionRange ?? c.rotationRange;
      if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] >= range[1]) throw new Error(`Invalid range: ${c.id}`);
      if (['suction', 'foam', 'engine_selector'].includes(c.id)) {
        const count = c.id === 'suction' ? 2 : 3;
        if (c.endpoints?.length !== count || new Set(c.endpoints.map(e => e.value)).size !== count) throw new Error(`Invalid detents: ${c.id}`);
        c.endpoints.forEach(e => bounded(e.value, ...range, `${c.id} detent`));
      }
    }
  }
  for (const id of CONTROL_IDS) if (!manifest.controls.find(c => c.id === id && c.enabled)) throw new Error(`Missing active control: ${id}`);
  if (manifest.controls.find(c => c.id === 'hale_prime')?.enabled !== false) throw new Error('HALE PRIME must remain inactive');
  return manifest;
}

// Incomplete records are valid records, never executable configurations. Calibration
// requires a future calibration validator; changing the status string cannot enable it.
export function validateProfile(profile, { executable = true, manifest } = {}) {
  if (profile?.schemaVersion !== 1) throw new Error('Unsupported profile schema');
  requireText(profile.profileId, 'profileId'); requireText(profile.version, 'profile version');
  if (!['incomplete', 'genericTraining', 'b54Calibrated'].includes(profile.profileStatus)) throw new Error('Invalid profile status');
  if (!Array.isArray(profile.provenance) || !profile.provenance.length) throw new Error('Provenance required');
  for (const p of profile.provenance) {
    if (!evidenceStatuses.includes(p.status) || !Array.isArray(p.parameters) || !p.parameters.length) throw new Error('Invalid provenance');
    p.parameters.forEach(path => requireText(path, 'provenance parameter'));
    requireText(p.source, 'provenance source');
  }
  if (profile.profileStatus === 'incomplete') {
    validateKnownRecord(profile);
    if (executable) throw new Error('Incomplete profile is not executable');
    return profile;
  }
  if (profile.profileStatus === 'b54Calibrated') throw new Error('B54 calibration validation is not implemented in Phase 1');
  if (!profile.provenance.some(p => p.status === 'assumedDemo' && p.parameters.includes('*'))) throw new Error('Generic profile must explicitly label all numerical settings assumedDemo');
  if (profile.units !== 'SI') throw new Error('Profile units must be SI');
  if (profile.drive?.mode !== 'scenarioControlled' || profile.drive.speedBasis !== 'normalized-reference') throw new Error('Only scenario-controlled normalized drive is supported');
  if (profile.pump?.velocityHeadPolicy !== 'negligible') throw new Error('Only explicitly negligible manifold velocity head is supported');
  validateCurve(profile.pump.curve);
  if (!['passiveResistance', 'closed'].includes(profile.pump.stoppedPolicy)) throw new Error('Unsupported stopped pump policy');
  if (profile.pump.stoppedPolicy === 'passiveResistance') positive(profile.pump.stoppedResistanceS2M5, 'stopped resistance');
  positive(profile.pump.passiveMaxFlowM3s, 'passive flow domain');
  if (profile.pump.ratingPa !== null) positive(profile.pump.ratingPa, 'ratingPa');
  finite(profile.pump.dischargeGaugeElevationM, 'gauge elevation');
  positive(profile.tank?.capacityM3, 'tank capacity');
  bounded(profile.tank.unusableVolumeM3, 0, profile.tank.capacityM3, 'unusable volume');
  if (profile.tank.unusableVolumeM3 === profile.tank.capacityM3) throw new Error('Tank requires usable volume');
  positive(profile.tank.areaM2, 'tank area'); finite(profile.tank.bottomElevationM, 'tank bottom');
  if (profile.tank.overflowPolicy !== 'spill' || profile.tank.pickupRecovery !== 'scenarioReset') throw new Error('Unsupported tank boundary policy');
  if (!['submerged', 'atmospheric'].includes(profile.tank.returnTermination)) throw new Error('Unsupported return termination');
  finite(profile.tank.returnElevationM, 'return elevation');
  if (profile.features?.directFill !== false || profile.features?.foam !== false || profile.features?.priming !== false) throw new Error('Phase 1 does not support direct fill, foam or priming');
  const n = profile.network;
  if (n?.topology !== 'parallel-forward' || !Array.isArray(n.nodes) || !Array.isArray(n.sources) || !Array.isArray(n.outlets)) throw new Error('Unsupported network topology');
  const nodes = new Set(n.nodes);
  if (nodes.size !== n.nodes.length) throw new Error('Duplicate network node');
  for (const id of ['tank', 'external', 'suction', 'discharge', 'atmosphere']) if (!nodes.has(id)) throw new Error(`Missing node ${id}`);
  const ids = new Set(), bindings = new Set();
  const checkEdge = (e, from, to, allowedControls) => {
    requireText(e.id, 'edge id');
    if (ids.has(e.id)) throw new Error('Duplicate edge id');
    ids.add(e.id);
    if (!nodes.has(e.from) || !nodes.has(e.to) || e.from !== from || e.to !== to) throw new Error(`Invalid edge nodes: ${e.id}`);
    if (e.direction !== 'forwardChecked' || e.checkValve !== 'assumedDemo') throw new Error(`Unsupported direction/check policy: ${e.id}`);
    if (e.controlId !== null) {
      if (!allowedControls.includes(e.controlId) || bindings.has(e.controlId)) throw new Error('Invalid or duplicate hydraulic control binding');
      bindings.add(e.controlId);
    }
    if (e.kind !== 'idealBoundary') {
      lossResistance(e.loss); valveResistance(e.valve, 1);
    }
  };
  n.sources.forEach(s => {
    if (!['tank', 'external', 'idealBoundary'].includes(s.kind)) throw new Error('Unsupported source');
    checkEdge(s, s.kind === 'tank' ? 'tank' : 'external', 'suction', s.kind === 'tank' ? ['tank_valve'] : ['suction']);
    if (s.kind !== 'tank') finite(s.headM, 'external source head');
    if (s.kind === 'idealBoundary' && (n.sources.length !== 1 || s.controlId !== null)) throw new Error('Ideal boundary is only supported as a sole unvalved test source');
  });
  if (n.sources.filter(s => s.kind === 'tank').length > 1) throw new Error('Only one tank pickup is supported');
  n.outlets.forEach(e => {
    checkEdge(e, 'discharge', 'atmosphere', OUTLET_IDS); finite(e.elevationM, 'outlet elevation');
    if (!['openNozzle', 'closedNozzle', 'openPipe', 'cap'].includes(e.termination)) throw new Error('Unsupported outlet termination');
    if (['openNozzle', 'closedNozzle'].includes(e.termination)) nozzleResistance(e.nozzle);
  });
  if (n.return) checkEdge(n.return, 'discharge', 'tank', ['tank_fill']);
  if (!Array.isArray(n.controlBindings)) throw new Error('Control bindings required');
  const controlIds = new Set();
  for (const b of n.controlBindings) {
    if (!CONTROL_IDS.includes(b.controlId) || controlIds.has(b.controlId)) throw new Error('Invalid or duplicate control binding');
    requireText(b.root, 'binding root'); controlIds.add(b.controlId);
  }
  if (controlIds.size !== CONTROL_IDS.length) throw new Error('All active controls require bindings');
  if (manifest) {
    validateManifest(manifest);
    for (const b of n.controlBindings) if (manifest.controls.find(c => c.id === b.controlId)?.node !== b.root) throw new Error(`Invalid control root: ${b.root}`);
  }
  const solver = profile.solver;
  if (!solver) throw new Error('Solver settings required');
  positive(solver.fixedStepS, 'fixed timestep');
  positive(solver.characteristicFlowM3s, 'characteristic flow');
  positive(solver.absoluteFlowToleranceM3s, 'absolute flow tolerance');
  positive(solver.relativeFlowTolerance, 'relative flow tolerance');
  positive(solver.headToleranceM, 'head tolerance');
  finite(solver.minSuctionHeadM, 'minimum suction head');
  if (!Number.isInteger(solver.iterations) || solver.iterations < 8 || solver.iterations > 64) throw new Error('Solver iterations must be an integer in [8,64]');
  return profile;
}
