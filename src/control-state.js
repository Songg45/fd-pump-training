export const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));
export const initialState = spec => ({ value: spec.neutral ?? 0, locked: !!spec.lock?.initialLocked });
export function keyboardMoveTarget(spec, state, direction) {
  if (!['twoStateSlider', 'threeStateSliderLock'].includes(spec.type)) return state.value + direction * 0.03;
  const values = spec.endpoints.map(p => p.value).sort((a, b) => a - b);
  return direction > 0 ? values.find(value => value > state.value + 1e-8) ?? values.at(-1) : values.findLast(value => value < state.value - 1e-8) ?? values[0];
}
export function move(spec, state, value) {
  if (!spec.enabled || state.locked || !spec.positionRange) return false;
  state.value = clamp(value, spec.positionRange);
  return true;
}
export function turn(spec, state, value) {
  if (!spec.enabled) return false;
  if (spec.lock) state.locked = value >= 0.5;
  else if (spec.rotationRange) state.value = clamp(value, spec.rotationRange);
  else return false;
  return true;
}
export function release(spec, state) {
  if (!spec.enabled || state.locked) return;
  if (['twoStateSlider', 'threeStateSliderLock', 'threePositionRotary'].includes(spec.type)) {
    state.value = spec.endpoints.reduce((best, p) => Math.abs(p.value - state.value) < Math.abs(best.value - state.value) ? p : best).value;
  }
}
export function describe(spec, state) {
  if (!spec.enabled) return 'Inactive · operation unconfirmed';
  if (spec.type === 'rotary') return `${Math.round(state.value / spec.rotationRange[1] * 100)}% open / increased`;
  const exact = spec.endpoints?.find(p => Math.abs(p.value - state.value) < 0.0001);
  if (exact) return exact.state;
  return spec.id === 'tank_valve' ? 'Between open and closed · pull to close' : 'Intermediate position';
}
