import { initialState, move, turn, release, keyboardMoveTarget } from '../control-state.js';
import { validateManifest, OUTLET_IDS } from './config.js';
import { finite } from './units.js';

const discreteIds = ['suction', 'foam', 'engine_selector'];
function detents(spec) {
  const values = spec.endpoints.map(e => e.value).sort((a, b) => a - b);
  if (spec.id === 'engine_selector') values.reverse();
  const modes = spec.id === 'suction' ? ['CLOSED', 'OPEN'] : spec.id === 'foam' ? ['PRIME', 'OFF', 'OPERATE'] : ['OFF', 'RUN', 'START'];
  return values.map((value, i) => ({ value, mode: modes[i] }));
}
const normalize = (value, [min, max]) => Math.max(0, Math.min(1, (value - min) / (max - min)));

/** Read accepted mechanical state only. Pass commitIds AFTER mechanical release or
 * a successful endpoint/keyboard operation. Intermediate visuals keep prior modes.
 * With no prior detents, exact initial endpoints seed modes; intermediate is null.
 */
export function readControlInputs(manifest, states, previousDetents, commitIds = []) {
  validateManifest(manifest);
  const specs = Object.fromEntries(manifest.controls.map(c => [c.id, c]));
  for (const c of manifest.controls) {
    if (!states[c.id] || typeof states[c.id].locked !== 'boolean') throw new Error(`Invalid accepted state: ${c.id}`);
    finite(states[c.id].value, c.id);
  }
  for (const id of commitIds) if (!specs[id]) throw new Error(`Unknown commit control: ${id}`);
  const committedDetents = {};
  for (const id of discreteIds) {
    const choices = detents(specs[id]), state = states[id];
    const previous = previousDetents?.[id] ?? null;
    if (previous !== null && !choices.some(p => p.mode === previous)) throw new Error(`Invalid committed detent: ${id}`);
    const exact = choices.find(p => p.value === state.value)?.mode ?? null;
    committedDetents[id] = previousDetents === undefined ? exact : previous;
    // Locking at an intermediate position retains its last committed mode.
    if (commitIds.includes(id) && !state.locked && exact !== null) committedDetents[id] = exact;
  }
  const openings = {};
  for (const id of [...OUTLET_IDS, 'tank_fill', 'tank_valve']) {
    const u = normalize(states[id].value, specs[id].positionRange);
    openings[id] = id === 'tank_valve' ? 1 - u : u;
  }
  openings.suction = committedDetents.suction === 'OPEN' ? 1 : 0;
  return {
    openings,
    speedDemand: normalize(states.throttle.value, specs.throttle.rotationRange),
    engineRequest: committedDetents.engine_selector,
    foamMode: committedDetents.foam,
    committedDetents,
    unassignedModes: discreteIds.filter(id => committedDetents[id] === null),
    waterPrimer: 'inactive',
  };
}

export function createControlFrame(manifest, acceptedStates) {
  const states = acceptedStates ? structuredClone(acceptedStates) : Object.fromEntries(manifest.controls.map(c => [c.id, initialState(c)]));
  const inputs = readControlInputs(manifest, states);
  return { states, inputs };
}

/** Pure bridge ready for Phase 2 wiring. It delegates mechanics to control-state.js
 * on a copy. Pointer move/turn => move/turn, pointer release => release, endpoint
 * buttons => endpoint, arrows => keyboard. No event changes the caller's frame.
 */
export function applyControlCommand(manifest, frame, command) {
  validateManifest(manifest);
  const spec = manifest.controls.find(c => c.id === command.id);
  if (!spec) throw new Error(`Unknown control: ${command.id}`);
  const states = structuredClone(frame.states), state = states[spec.id];
  let accepted = false, commit = false;
  if (command.type === 'move' || command.type === 'turn') {
    finite(command.value, 'command value');
    accepted = (command.type === 'move' ? move : turn)(spec, state, command.value);
  } else if (command.type === 'release') {
    accepted = spec.enabled && !state.locked;
    release(spec, state); commit = accepted;
  } else if (command.type === 'endpoint') {
    if (!spec.endpoints?.some(p => p.value === command.value)) throw new Error('Command must name a manifest endpoint');
    accepted = (spec.rotationRange ? turn : move)(spec, state, command.value);
    if (accepted) { release(spec, state); commit = true; }
  } else if (command.type === 'keyboard') {
    if (![1, -1].includes(command.direction)) throw new Error('Keyboard direction must be +1 or -1 in mechanical coordinates');
    if (spec.rotationRange) {
      const step = spec.type === 'threePositionRotary' ? Math.abs(spec.endpoints[1].value - spec.endpoints[0].value) : Math.PI / 12;
      accepted = turn(spec, state, state.value + command.direction * step);
    } else accepted = move(spec, state, keyboardMoveTarget(spec, state, command.direction));
    if (accepted) { release(spec, state); commit = true; }
  } else throw new Error(`Unknown command type: ${command.type}`);
  const inputs = readControlInputs(manifest, states, frame.inputs.committedDetents, commit ? [spec.id] : []);
  return { states, inputs, accepted };
}
