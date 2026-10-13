import { Vector3, Quaternion } from 'three';

export function applyPose(root, spec, state, basePosition, baseQuaternion) {
  root.position.copy(basePosition);
  // Translation is in the exported parent's basis, never the rotated handle basis.
  if (spec.positionAxis) root.position.addScaledVector(new Vector3(...spec.positionAxis), state.value);
  root.quaternion.copy(baseQuaternion);
  const angle = spec.lock ? (state.locked ? spec.lock.lockedAngle : spec.lock.unlockedAngle) : spec.rotationRange ? state.value : 0;
  const axis = spec.lock?.axis ?? spec.rotationAxis;
  if (axis) root.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(...axis), angle));
  root.updateMatrixWorld(true);
}

export function movementDelta(spec, dx, dy, pixelsPerMeter, direction) {
  return spec.positionAxis?.[2] ? -dy * 0.003 : dx * direction / Math.max(90, pixelsPerMeter);
}
