import { validateProfile } from './config.js';
import { bounded, finite } from './units.js';
import { solveNetwork } from './network.js';

const ledgerKeys = ['tankOutM3', 'returnM3', 'externalIntakeM3', 'deliveredM3', 'directFillM3', 'overflowM3', 'drainM3', 'pumpThroughM3'];
export function createSimulationState(profile, scenario) {
  validateProfile(profile);
  if (typeof scenario?.id !== 'string' || typeof scenario.version !== 'string') throw new Error('Scenario id/version required');
  bounded(scenario.tankVolumeM3, 0, profile.tank.capacityM3, 'initial tank volume');
  bounded(scenario.speedRatio, 0, 1, 'scenario speed');
  if (!['filled', 'dry', 'supplyLost'].includes(scenario.pumpLiquid) || typeof scenario.pickupWet !== 'boolean' || typeof scenario.externalAvailable !== 'boolean') throw new Error('Explicit scenario liquid/source states required');
  if (scenario.pickupWet && scenario.tankVolumeM3 <= profile.tank.unusableVolumeM3) throw new Error('Dry pickup cannot be initialized wet');
  const state = {
    profileId: profile.profileId, profileVersion: profile.version, scenarioId: scenario.id, scenarioVersion: scenario.version,
    tick: 0, timeS: 0, initialTankVolumeM3: scenario.tankVolumeM3, tankVolumeM3: scenario.tankVolumeM3,
    speedRatio: scenario.speedRatio, pumpLiquid: scenario.pumpLiquid, pickupWet: scenario.pickupWet,
    externalAvailable: scenario.externalAvailable,
    cumulative: Object.fromEntries(ledgerKeys.map(key => [key, 0])), massBalanceErrorM3: 0,
    lastSolve: null, events: [],
  };
  return state;
}

/** One pure fixed tick. Scenario speed is imposed directly (no engine/start model).
 * Hydraulic rates are held over each segment, then re-solved at dry/full events.
 * A numerical/domain failure rolls back the ENTIRE tick; no stale flow is integrated.
 * No-supply/unprimed states advance time with zero transport, without auto-priming.
 */
export function stepSimulation(profile, state, commands) {
  validateProfile(profile);
  if (state.profileId !== profile.profileId || state.profileVersion !== profile.version) throw new Error('State/profile version mismatch');
  if (!Number.isSafeInteger(state.tick) || state.tick < 0) throw new Error('Invalid tick');
  bounded(state.timeS, 0, Number.MAX_VALUE, 'time');
  bounded(state.tankVolumeM3, 0, profile.tank.capacityM3, 'tank volume');
  bounded(state.initialTankVolumeM3, 0, profile.tank.capacityM3, 'initial tank volume');
  ledgerKeys.forEach(key => bounded(state.cumulative[key], 0, Number.MAX_VALUE, key));
  const next = structuredClone(state), dt = profile.solver.fixedStepS;
  next.events = [];
  const speedRatio = commands.speedRatio ?? state.speedRatio;
  bounded(speedRatio, 0, 1, 'scenario speedRatio');
  const rollback = result => ({ ...structuredClone(state), lastSolve: result, events: ['tickSuspended', result.status] });
  let remaining = dt;
  for (let segment = 0; remaining > 0 && segment < 4; segment++) {
    const result = solveNetwork(profile, { ...next, openings: commands.openings, speedRatio });
    next.lastSolve = result;
    if (!result.ok) {
      if (['noSupply', 'unprimed'].includes(result.status)) { next.events.push(result.status); remaining = 0; break; }
      return rollback(result);
    }
    next.events.push(...result.events);
    const f = result.flows;
    const rawNet = f.returnM3s - f.tankOutM3s;
    const full = next.tankVolumeM3 === profile.tank.capacityM3;
    const overflow = full ? Math.max(0, rawNet) : 0;
    const net = rawNet - overflow;
    let duration = remaining, boundary = null;
    if (net < 0) {
      const untilDry = (next.tankVolumeM3 - profile.tank.unusableVolumeM3) / -net;
      if (untilDry >= 0 && untilDry <= remaining) { duration = untilDry; boundary = 'pickupDry'; }
    } else if (net > 0 && !full) {
      const untilFull = (profile.tank.capacityM3 - next.tankVolumeM3) / net;
      if (untilFull <= remaining) { duration = untilFull; boundary = 'tankFull'; }
    }
    const increments = { tankOutM3: f.tankOutM3s, returnM3: f.returnM3s, externalIntakeM3: f.externalIntakeM3s,
      deliveredM3: f.deliveredM3s, overflowM3: overflow, pumpThroughM3: result.pumpFlowM3s };
    for (const [key, rate] of Object.entries(increments)) next.cumulative[key] = finite(next.cumulative[key] + rate * duration, key);
    next.tankVolumeM3 += net * duration;
    remaining = Math.max(0, remaining - duration);
    if (boundary === 'pickupDry') {
      next.tankVolumeM3 = profile.tank.unusableVolumeM3;
      next.pickupWet = false;
    } else if (boundary === 'tankFull') next.tankVolumeM3 = profile.tank.capacityM3;
    if (boundary) next.events.push(boundary);
    if (overflow > 0) next.events.push('overflow');
  }
  if (remaining > 0) return rollback({ ok: false, status: 'boundaryIterationLimit', flows: null });
  next.tick++;
  next.timeS = finite(next.timeS + dt, 'simulation time');
  next.speedRatio = speedRatio;
  // Report an endpoint solve, not the pre-depletion flow as a current reading.
  next.lastSolve = solveNetwork(profile, { ...next, openings: commands.openings, speedRatio });
  if (!next.lastSolve.ok && !['noSupply', 'unprimed'].includes(next.lastSolve.status)) return rollback(next.lastSolve);
  const c = next.cumulative;
  next.massBalanceErrorM3 = next.tankVolumeM3 - next.initialTankVolumeM3 - c.externalIntakeM3 - c.directFillM3 + c.deliveredM3 + c.overflowM3 + c.drainM3;
  next.events = [...new Set([...next.events, ...next.lastSolve.events])];
  return next;
}
