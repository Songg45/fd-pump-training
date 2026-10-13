import { bounded, finite, GRAVITY_M_S2 as g } from './units.js';

export function positive(value, name) {
  finite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}

export function validateCurve(curve) {
  if (!curve || curve.speedBasis !== 'normalized-reference' || curve.ordinate !== 'totalHeadM') throw new Error('Curve requires normalized-reference speed and totalHeadM ordinate');
  positive(curve.maxFlowM3s, 'curve.maxFlowM3s');
  if (curve.type === 'quadratic') {
    positive(curve.shutoffHeadM, 'curve.shutoffHeadM');
    positive(curve.coefficientS2M5, 'curve.coefficientS2M5');
    if (curve.shutoffHeadM - curve.coefficientS2M5 * curve.maxFlowM3s ** 2 < -1e-10) throw new Error('Curve domain includes negative pump head');
  } else if (curve.type === 'table') {
    if (!Array.isArray(curve.points) || curve.points.length < 2) throw new Error('Curve needs at least two points');
    curve.points.forEach((p, i) => {
      bounded(p.flowM3s, 0, curve.maxFlowM3s, 'curve flow');
      bounded(p.headM, 0, Number.MAX_VALUE, 'curve head');
      if (i && (p.flowM3s <= curve.points[i - 1].flowM3s || p.headM >= curve.points[i - 1].headM)) throw new Error('Curve flow must increase and head must strictly decrease');
    });
    if (curve.points[0].flowM3s !== 0 || curve.points.at(-1).flowM3s !== curve.maxFlowM3s) throw new Error('Curve endpoints must span [0, maxFlowM3s]');
  } else throw new Error(`Unsupported curve type: ${curve.type}`);
}

export function pumpHeadM(curve, flowM3s, speedRatio) {
  // Validated curves are used by the solver; the public component also checks them.
  validateCurve(curve);
  bounded(speedRatio, 0, 1, 'speedRatio');
  if (!speedRatio) throw new Error('Zero speed requires the separate passive-pump policy');
  bounded(flowM3s, 0, curve.maxFlowM3s * speedRatio, 'pump flow domain');
  // Division can round a legal scaled endpoint above the reference endpoint.
  // The strict scaled-domain check above still rejects actual extrapolation.
  const q = Math.min(curve.maxFlowM3s, flowM3s / speedRatio);
  let head;
  if (curve.type === 'quadratic') head = curve.shutoffHeadM - curve.coefficientS2M5 * q ** 2;
  else {
    const right = curve.points.findIndex(p => p.flowM3s >= q);
    if (right === 0) head = curve.points[0].headM;
    else {
      const a = curve.points[right - 1], b = curve.points[right];
      head = a.headM + (b.headM - a.headM) * (q - a.flowM3s) / (b.flowM3s - a.flowM3s);
    }
  }
  return finite(head * speedRatio ** 2, 'pump head');
}

export function lossResistance(loss) {
  if (loss?.type === 'quadratic') return bounded(loss.resistanceS2M5, 0, Number.MAX_VALUE, 'loss resistance');
  if (loss?.type !== 'darcy') throw new Error('Unsupported loss model');
  positive(loss.internalDiameterM, 'internal diameter');
  bounded(loss.lengthM, 0, Number.MAX_VALUE, 'length');
  bounded(loss.darcyFrictionFactor, 0, Number.MAX_VALUE, 'Darcy friction factor');
  bounded(loss.fittingsK, 0, Number.MAX_VALUE, 'fittings K');
  const area = Math.PI * loss.internalDiameterM ** 2 / 4;
  return finite((loss.darcyFrictionFactor * loss.lengthM / loss.internalDiameterM + loss.fittingsK) / (2 * g * area ** 2), 'Darcy resistance');
}

export function nozzleResistance(nozzle) {
  if (nozzle?.type !== 'fixedOrifice') throw new Error('Unsupported nozzle model');
  positive(nozzle.diameterM, 'nozzle diameter');
  bounded(nozzle.dischargeCoefficient, Number.MIN_VALUE, 1, 'nozzle discharge coefficient');
  const area = Math.PI * nozzle.diameterM ** 2 / 4;
  return finite(1 / (2 * g * (nozzle.dischargeCoefficient * area) ** 2), 'nozzle resistance');
}

export function valveResistance(valve, opening) {
  bounded(opening, 0, 1, 'opening');
  positive(valve.fullConductanceM3sPerSqrtM, 'valve conductance');
  positive(valve.exponent, 'valve characteristic exponent');
  // null removes an edge exactly; no artificial huge resistance or leakage.
  if (opening === 0) return null;
  const conductance = valve.fullConductanceM3sPerSqrtM * opening ** valve.exponent;
  // Underflow is a closed numerical edge, never an infinite result.
  if (conductance === 0 || !Number.isFinite(1 / conductance ** 2)) return null;
  return 1 / conductance ** 2;
}

export function forwardFlowM3s(headDifferenceM, resistanceS2M5) {
  finite(headDifferenceM, 'head difference');
  positive(resistanceS2M5, 'resistance');
  return headDifferenceM <= 0 ? 0 : finite(Math.sqrt(headDifferenceM / resistanceS2M5), 'flow');
}
