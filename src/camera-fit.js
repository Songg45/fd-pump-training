import { Vector3 } from 'three';

export function panelFraming(manifest) {
  const bounds = manifest.rearPanel.bounds;
  const axialTravel = Math.max(0, ...manifest.controls.filter(c => c.enabled && c.positionAxis?.[2]).map(c => c.positionRange[1]));
  const points = [];
  // The manifest describes the backing face. Include projecting fittings, labels,
  // and the full axial handle extension when fitting the close panel preset.
  for (const x of [bounds.min[0] - 0.08, bounds.max[0] + 0.08])
    for (const y of [bounds.min[1] - 0.1, bounds.max[1] + 0.1])
      for (const z of [bounds.min[2], bounds.max[2] + axialTravel + 0.2]) points.push(new Vector3(x, y, z));
  return points;
}

export function fitPerspective(camera, target, points, minimumDistance = 0, margin = 0.9) {
  const direction = camera.position.clone().sub(target).normalize();
  camera.lookAt(target); camera.updateMatrixWorld();
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const tanY = Math.tan(camera.fov * Math.PI / 360), tanX = tanY * camera.aspect;
  let distance = minimumDistance;
  for (const point of points) {
    const p = point.clone().sub(target), depth = p.dot(direction);
    distance = Math.max(distance, depth + Math.abs(p.dot(right)) / (tanX * margin), depth + Math.abs(p.dot(up)) / (tanY * margin));
  }
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(target); camera.updateMatrixWorld();
}
