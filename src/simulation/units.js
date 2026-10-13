// SI internally. US gallons only; these constants never imply apparatus accuracy.
export const US_GALLON_M3 = 0.003785411784;
export const US_GPM_M3S = US_GALLON_M3 / 60;
export const PSI_PA = 6894.757293168;
export const GRAVITY_M_S2 = 9.80665;
export const WATER_DENSITY_KG_M3 = 1000;

export function finite(value, name = 'value') {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
export function bounded(value, min, max, name = 'value') {
  finite(value, name);
  if (value < min || value > max) throw new RangeError(`${name} must be in [${min}, ${max}]`);
  return value;
}
const scale = (value, factor) => finite(finite(value) * factor, 'converted quantity');
export const gallonsToM3 = value => scale(value, US_GALLON_M3);
export const m3ToGallons = value => scale(value, 1 / US_GALLON_M3);
export const gpmToM3s = value => scale(value, US_GPM_M3S);
export const m3sToGpm = value => scale(value, 1 / US_GPM_M3S);
export const psiToPa = value => scale(value, PSI_PA);
export const paToPsi = value => scale(value, 1 / PSI_PA);
export const headToPa = value => scale(value, WATER_DENSITY_KG_M3 * GRAVITY_M_S2);
export const paToHead = value => scale(value, 1 / (WATER_DENSITY_KG_M3 * GRAVITY_M_S2));
