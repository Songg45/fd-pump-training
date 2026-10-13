import { readFileSync } from 'node:fs';
import { validateProfile } from '../src/simulation/config.js';
import { createControlFrame, applyControlCommand } from '../src/simulation/control-inputs.js';
import { createSimulationState, stepSimulation } from '../src/simulation/step.js';
import { m3ToGallons, m3sToGpm, paToPsi } from '../src/simulation/units.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const profile = json('../public/simulation/generic-training.json');
const manifest = json('../public/models/b54-controls.json');
validateProfile(profile, { manifest });
let controls = createControlFrame(manifest);
const outlet = manifest.controls.find(c => c.id === 'hose_reel');
controls = applyControlCommand(manifest, controls, { id: outlet.id, type: 'move', value: outlet.positionRange[1] * 0.4 });
controls = applyControlCommand(manifest, controls, { id: outlet.id, type: 'turn', value: 1 });
let state = createSimulationState(profile, {
  id: 'headless-generic-one-line', version: '1', tankVolumeM3: 0.5,
  pickupWet: true, pumpLiquid: 'filled', speedRatio: 0.75, externalAvailable: false,
});
for (let tick = 0; tick < 500; tick++) {
  state = stepSimulation(profile, state, { openings: controls.inputs.openings });
  if (state.tick !== tick + 1) throw new Error(`Tick suspended: ${state.lastSolve.status}`);
}
console.log(profile.label);
console.log('Headless setup: filled pump/hoses, scenario-imposed 75% speed, synthetic hose-reel branch locked at 40% opening.');
console.log(JSON.stringify({
  profile: `${state.profileId}@${state.profileVersion}`, scenario: `${state.scenarioId}@${state.scenarioVersion}`,
  ticks: state.tick, seconds: state.timeS, status: state.lastSolve.status,
  dischargePsig: paToPsi(state.lastSolve.dischargePressurePa), deliveredGpm: m3sToGpm(state.lastSolve.flows.deliveredM3s),
  tankUSGallons: m3ToGallons(state.tankVolumeM3), deliveredUSGallons: m3ToGallons(state.cumulative.deliveredM3),
  massBalanceErrorM3: state.massBalanceErrorM3,
}, null, 2));
