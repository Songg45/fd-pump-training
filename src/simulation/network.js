import { validateProfile } from './config.js';
import { bounded, finite, headToPa } from './units.js';
import { pumpHeadM, lossResistance, nozzleResistance, valveResistance, forwardFlowM3s } from './components.js';

const failure = (status, message) => ({ ok: false, status, message, suctionHeadM: null, dischargeHeadM: null, pumpFlowM3s: null, flows: null, events: [] });
export const tankHeadM = (profile, volumeM3) => profile.tank.bottomElevationM + volumeM3 / profile.tank.areaM2;
const sum = values => values.reduce((a, b) => a + b, 0);
function bisect(fn, low, high, iterations) {
  for (let i = 0; i < iterations; i++) {
    const mid = low + (high - low) / 2;
    if (fn(mid) > 0) high = mid; else low = mid;
  }
  return low + (high - low) / 2;
}

/** Quasi-steady two-manifold reduction; all paths are explicitly forward checked.
 * Failure results contain no usable flows. This function mutates neither argument.
 */
export function solveNetwork(profile, input) {
  try {
    validateProfile(profile);
    bounded(input.speedRatio, 0, 1, 'speedRatio');
    bounded(input.tankVolumeM3, 0, profile.tank.capacityM3, 'tank volume');
    if (typeof input.pickupWet !== 'boolean' || typeof input.externalAvailable !== 'boolean') throw new Error('Source availability must be boolean');
    if (!['filled', 'dry', 'supplyLost'].includes(input.pumpLiquid)) throw new Error('Invalid pump liquid state');
    const edges = [...profile.network.sources, ...profile.network.outlets, ...(profile.network.return ? [profile.network.return] : [])];
    const opening = e => e.controlId === null ? 1 : bounded(input.openings?.[e.controlId], 0, 1, `opening ${e.controlId}`);
    edges.forEach(opening);
    if (input.pumpLiquid !== 'filled') return failure('unprimed', 'Only scenario-provided filled pump operation is supported; no automatic prime');
    const resistance = e => {
      const rv = valveResistance(e.valve, opening(e));
      return rv === null ? null : finite(rv + lossResistance(e.loss), `${e.id} resistance`);
    };
    const tankHead = tankHeadM(profile, input.tankVolumeM3);
    const sources = profile.network.sources.filter(s => s.kind === 'tank'
      ? input.pickupWet && input.tankVolumeM3 > profile.tank.unusableVolumeM3
      : input.externalAvailable).map(s => ({
      ...s, head: s.kind === 'tank' ? tankHead : s.headM,
      resistance: s.kind === 'idealBoundary' ? 0 : resistance(s),
    })).filter(s => s.resistance !== null);
    if (!sources.length) return failure('noSupply', 'No connected usable liquid source; suction pressure is unanchored');
    const flowTolerance = Math.max(profile.solver.absoluteFlowToleranceM3s, profile.solver.relativeFlowTolerance * profile.solver.characteristicFlowM3s);
    const ideal = sources[0].kind === 'idealBoundary';
    const highHead = Math.max(...sources.map(s => s.head));
    const minHead = profile.solver.minSuctionHeadM;
    if (highHead < minHead) return failure('sourceDomain', 'Source lies below the declared suction-head domain');
    const sourceFlows = hs => sources.map(s => forwardFlowM3s(s.head - hs, s.resistance));
    const sourceMax = ideal ? Number.MAX_VALUE : sum(sourceFlows(minHead));
    function suction(q) {
      if (ideal) return { head: sources[0].head, flows: [q] };
      if (q === 0) return { head: highHead, flows: sources.map(() => 0) };
      const head = bisect(h => q - sum(sourceFlows(h)), minHead, highHead, profile.solver.iterations);
      return { head, flows: sourceFlows(head) };
    }
    const outlets = profile.network.outlets.map(e => ({ ...e, resistance: resistance(e) }));
    const ret = profile.network.return;
    const returnResistance = ret ? resistance(ret) : null;
    const returnHead = profile.tank.returnTermination === 'submerged' ? tankHead : profile.tank.returnElevationM;
    function demand(hd) {
      const flows = outlets.map(e => e.resistance === null || ['cap', 'closedNozzle'].includes(e.termination) ? 0
        : forwardFlowM3s(hd - e.elevationM, e.resistance + (e.termination === 'openNozzle' ? nozzleResistance(e.nozzle) : 0)));
      const returned = returnResistance === null ? 0 : forwardFlowM3s(hd - returnHead, returnResistance);
      return { flows, returned, total: sum(flows) + returned };
    }
    const stopped = input.speedRatio === 0;
    if (stopped && profile.pump.stoppedPolicy === 'closed') {
      return { ok: true, status: 'stoppedIsolated', suctionHeadM: highHead, dischargeHeadM: null, dischargePressurePa: null,
        pumpFlowM3s: 0, pumpHeadM: 0, flows: { tankOutM3s: 0, externalIntakeM3s: 0, returnM3s: 0, deliveredM3s: 0,
          outletsM3s: Object.fromEntries(outlets.map(e => [e.id, 0])), sourcesM3s: Object.fromEntries(sources.map(s => [s.id, 0])) },
        lines: Object.fromEntries(outlets.map(e => [e.id, { headM: null, pressurePa: null, status: 'unavailable' }])),
        residuals: { suctionM3s: 0, dischargeM3s: 0, headM: 0 }, events: [] };
    }
    const curveMax = stopped ? profile.pump.passiveMaxFlowM3s : profile.pump.curve.maxFlowM3s * input.speedRatio;
    const maxFlow = Math.min(curveMax, sourceMax);
    function trial(q) {
      const inlet = suction(q);
      const head = stopped ? -profile.pump.stoppedResistanceS2M5 * q ** 2 : pumpHeadM(profile.pump.curve, q, input.speedRatio);
      const discharge = finite(inlet.head + head, 'discharge head');
      const outlet = demand(discharge);
      return { inlet, head, discharge, outlet, residual: q - outlet.total };
    }
    const zero = trial(0);
    let q = 0, point = zero;
    if (zero.residual !== 0) {
      const upper = trial(maxFlow);
      if (upper.residual < 0) return failure(sourceMax < curveMax ? 'sourceDomain' : 'curveDomain', 'No operating point within the declared flow/head domain');
      q = bisect(value => trial(value).residual, 0, maxFlow, profile.solver.iterations);
      point = trial(q);
    }
    const suctionResidual = q - sum(point.inlet.flows), dischargeResidual = q - point.outlet.total;
    const headResidual = point.discharge - point.inlet.head - point.head;
    if (Math.abs(suctionResidual) > flowTolerance || Math.abs(dischargeResidual) > flowTolerance || Math.abs(headResidual) > profile.solver.headToleranceM) return failure('residualFailure', 'Continuity/head residual exceeds configured tolerance');
    const sourceLedger = kind => sum(sources.map((s, i) => (s.kind === 'tank') === (kind === 'tank') ? point.inlet.flows[i] : 0));
    const pressure = headToPa(point.discharge - profile.pump.dischargeGaugeElevationM);
    const lines = Object.fromEntries(outlets.map((e, i) => {
      if (e.resistance === null) return [e.id, { headM: null, pressurePa: null, status: 'isolated' }];
      const headM = point.discharge - valveResistance(e.valve, opening(e)) * point.outlet.flows[i] ** 2;
      return [e.id, { headM, pressurePa: headToPa(headM - e.elevationM), status: point.outlet.flows[i] ? 'flowing' : 'connectedStatic' }];
    }));
    return { ok: true, status: q === 0 ? stopped ? 'stoppedStatic' : 'deadhead' : stopped ? 'passive' : 'flowing',
      suctionHeadM: point.inlet.head, dischargeHeadM: point.discharge, dischargePressurePa: pressure,
      pumpFlowM3s: q, pumpHeadM: point.head,
      flows: { tankOutM3s: sourceLedger('tank'), externalIntakeM3s: sourceLedger('external'), returnM3s: point.outlet.returned,
        deliveredM3s: sum(point.outlet.flows), outletsM3s: Object.fromEntries(outlets.map((e, i) => [e.id, point.outlet.flows[i]])),
        sourcesM3s: Object.fromEntries(sources.map((s, i) => [s.id, point.inlet.flows[i]])) },
      lines, residuals: { suctionM3s: suctionResidual, dischargeM3s: dischargeResidual, headM: headResidual },
      events: profile.pump.ratingPa !== null && pressure > profile.pump.ratingPa ? ['dischargeRatingExceeded'] : [],
    };
  } catch (error) { return failure('invalidInput', error.message); }
}
