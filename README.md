# B54 pump panel practice

A local Three.js viewer of the photo-informed B54 Ford F-550 brush truck. Orbit the complete model, move to the rear pump panel, and operate the visible 3D handles. The browser provides control familiarization; hydraulics are not connected to the viewer. Gauges and unconfirmed switches remain static. A separate Phase 1 headless hydraulic core now supports a clearly labeled synthetic generic exercise; it makes no calibrated B54 performance claims.

## Run locally

Requires Node.js 22.12+ (verified with Node.js 24.19.0).

```powershell
npm install
npm run dev
```

Open the Local URL printed by Vite, normally `http://localhost:5173`. The server binds to loopback. The app loads its GLB, control manifest, and JavaScript locally; it uses no CDN, remote textures, fonts, or original photographs.

If this Windows installation needs the system certificate store or a writable npm cache:

```powershell
node --use-system-ca 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' install --cache .qa/npm-cache
```

```powershell
npm test
npm run validate:model
npm run build
npm run preview
```

`build` creates a static `dist` directory. No hosting registration or publication is configured. `Pictures/B54` is ignored and is never copied into the browser assets.

## Controls

- Drag empty space to orbit and scroll/pinch to zoom. Whole truck, Front, Rear, and Pump panel buttons give useful camera positions. Camera changes preserve handle state.
- Click a visible 3D handle or select its name in the control list. Selected geometry glows amber without changing other objects sharing its original material. **Focus handle** moves the camera closer to the selected handle. Return to **Pump panel** to see the full panel.
- In **Move** mode, drag a push/pull handle **up to pull out**, **down to push in**. This consistent screen gesture works even with a directly rear-on camera. Horizontal handles follow left/right dragging. Release suction to snap closed/left or open/right; foam snaps prime/left, off/center, or operate/right.
- In **Turn** mode (or with Shift held while starting a drag), drag a locking handle **right to lock** and **left to unlock**. A quarter turn shows the change. A locked handle cannot translate at all. Accessible **Turn to lock / unlock** and endpoint buttons provide equivalent actions.
- Throttle: drag left to turn counterclockwise and increase/open; right to decrease/close. OFF/RUN/START: drag right to advance and release to keep the nearest position. START persists; no spring return is invented.
- With the canvas focused, arrow keys move or turn the selected handle. Up/right pulls or moves right; down/left pushes or moves left. For rotary controls, left/up turns counterclockwise, right/down clockwise. **L** toggles a handle lock. Equivalent labeled buttons also work with keyboard focus.
- **Reset controls** returns every control to its rest pose. HALE PRIME remains inactive because operation is unconfirmed. The lower tank valve is reversed: **pull to close**.

Model proportions, push/pull travel (about 0.6 m), lock angles, throttle one-turn range, and selector visual angles are approximate. The lower tank valve's travel and locking mechanics are provisional. See [models/README.md](models/README.md) for source/model details.

## Implementation and verification

Run `npm run simulate:water` for the deterministic headless exercise. [Phase 1 core documentation](docs/water-flow-core.md) explains the profile, control-adapter, solver and fixed-step APIs, known limitations, and validation coverage. The separate [B54 record](public/simulation/b54-incomplete.json) preserves confirmed nameplate/tank/hose/path facts and remains incomplete and nonexecutable. The [generic preset](public/simulation/generic-training.json) supplies all explicitly assumed numerical values. `npm test` includes the new numerical/conservation tests together with the existing viewer regressions; no browser simulation scheduler or dynamic instruments are enabled.

`src/control-state.js` centralizes movement bounds, positive locks, snap positions, and status descriptions. `src/control-pose.js` preserves the model's rest transforms and keeps slider motion independent of lock rotation. `tests/controls.test.js` tests all enabled locking controls, unlock behavior, boundary clamping, suction and foam positions, tank valve mapping, persistent selector positions, throttle bounds, and inactive primer behavior. It also loads the actual GLB with Three.js and verifies all named handles, visible lock rotation, exact locked root positions, parent-basis slider motion, and the directly rear-on pull gesture. `scripts/validate_b54_model.mjs` checks the actual GLB's named roots and model structure.

The viewer preserves each root's initial position/quaternion. Slider offsets stay in the exported parent axes, independently of handle rotation. Static model meshes are batched by material and compatible vertex attributes; all 13 control hierarchies remain separate for pointer hit resolution and motion. Pixel ratio is capped and local environment lighting provides chrome reflections. Pointer release, cancellation, loss of capture, window blur, reset, and camera changes restore orbit interaction.

Camera presets fit the model to the current canvas aspect ratio using the original meshes' transformed bounds. Whole truck, Front, and Rear retain the full truck; Pump panel consumes the manifest's backing-face bounds and camera metadata, allowing depth for fittings and the full axial handle travel. Resizing recomputes the active preset. Camera-fit tests verify the truck and panel bounds stay within the padded viewport across desktop and narrow canvas dimensions. Keyboard suction and foam movement selects the next manifest endpoint, so panel-width changes do not require new numeric keyboard steps.

For local browser QA, `window.b54Viewer.snapshot()` reports current control values, lock states, actual root transforms, orbit/drag state, and draw calls. It exposes no mutation API. Build and state tests do not establish successful visual rendering or direct pointer interaction; those require a rendered browser check.
