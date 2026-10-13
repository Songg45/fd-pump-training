# Phase 1: headless water-flow core

This checkpoint implements the numerical and mechanical contracts from [the water-flow plan](water-flow-simulation-plan.md). The existing browser remains a control-familiarization viewer with static instruments. Nothing in `src/main.js`, the mechanical control modules, the control manifest, the GLB, or model generation enables or changes simulation.

Run the deterministic generic exercise and checks from the repository root:

```powershell
npm run simulate:water
npm test
npm run validate:model
npm run build
```

Tests are deliberately in `tests/simulation.test.js`, so the existing `tests/*.test.js` discovery includes both original viewer tests and the new suite without a recursive glob or new dependency.

## Profiles and scope

`public/simulation/b54-incomplete.json` records Waterous E511-A, serial 119059, October 2004, the 220 PSIG nameplate, 300 US gallons, two nominal 100-foot preconnect hose classes, and the two user-confirmed tank path functions. It includes per-field/group evidence and unknown values. Those hose classes have no assigned branch or nozzle; booster-reel length is unknown. The 220 PSIG value is metadata, not a pump curve or pressure control.

`public/simulation/generic-training.json` is an executable **synthetic generic preset, not calibrated B54 performance**. Its one-cubic-meter constant-area tank, pump curve, losses, nozzle orifices, assumed check valves, external boundary and operating limits are original demo assumptions. It binds all six outlet controls but assigns no B54 hose lengths or real nozzle ratings. The external source uses a boundary head plus finite intake resistance; it is not a hydrant specification. Wildcard `assumedDemo` provenance explicitly covers every numeric/profile assumption.

`validateProfile(profile, { executable: false })` permits incomplete records and checks their known numerical values. The default requires an executable profile. Incomplete records cannot run; `b54Calibrated` is explicitly rejected pending a future calibration validator, even if somebody changes only the status string. Passing `{ manifest }` also validates all control IDs and their exact named roots. Call it when loading a profile alongside the actual viewer manifest. The numerical solver validates profile structure independently of Three.js and cannot inspect GLB geometry.

Supported network policies are intentionally narrow:

- Two lumped junctions, suction and discharge, with parallel outlets and one optional tank return. Tank/external source paths have positive loss and valve resistance. Every edge declares an assumed forward check valve. A sole, unvalved ideal pressure boundary is available only as an explicitly named analytic fixture.
- Quadratic synthetic pump curves and strictly decreasing piecewise-linear head/flow tables on an explicit forward-flow domain. Speed is a normalized ratio in `[0,1]`; no engine RPM, gear ratio, power limit or ability to hold speed is inferred.
- Quadratic effective losses or constant Darcy-friction-factor pipe/fitting losses; fixed-orifice nozzles, open pipes, closed nozzles and caps. Valve conductance is `Cfull * opening^exponent`. At exactly zero opening the path is removed. Numerically unrepresentable conductance at extremely tiny openings is treated as a closed numerical edge; ordinary partial openings remain continuous.
- Submerged return (receives tank surface head) or atmospheric return at its declared elevation; a constant-area tank with explicit unusable volume, spill overflow and scenario-reset-only pickup recovery.
- A stopped pump can be an explicit positive passive resistance or a closed edge. Externally pressurized flow remains possible through the passive option. No automatically inferred bypass exists.

Bidirectional/reverse flow, unknown check rules, arbitrary loops, flange velocity corrections, automatic/selectable nozzles, relief branches, direct fill, drains, multiple storage volumes, engine/start dynamics, automatic priming, foam, air/charging, cavitation and heat are unsupported in this checkpoint. Unsupported supplied policies fail validation. The manifold velocity-head correction is explicitly neglected. No quasi-steady result should be read as a transient or calibrated real-truck prediction.

## Control API

`src/simulation/control-inputs.js` reads copies of accepted mechanical states. It never writes into the viewer's state and imports only the existing pure mechanics from `control-state.js`, not Three.js.

```js
import { createControlFrame, applyControlCommand } from './src/simulation/control-inputs.js';

let frame = createControlFrame(manifest); // or supply copied accepted states
frame = applyControlCommand(manifest, frame, {
  id: 'hose_reel', type: 'move', value: 0.237,
});
frame = applyControlCommand(manifest, frame, {
  id: 'hose_reel', type: 'turn', value: 1, // locks at precisely that extension
});
const { openings, speedDemand, engineRequest, foamMode } = frame.inputs;
```

`value` uses the existing manifest's mechanical coordinate, not normalized hydraulic opening. Axial normalization reads each current range; `tank_valve` reverses it. Throttle uses the manifest rotation range: increasing accepted counterclockwise angle increases `speedDemand`. Every command returns a new frame; it delegates acceptance, locking and release snapping to the existing mechanical functions.

The bridge accepts `move`, `turn`, `release`, `endpoint` (an exact manifest endpoint value), and `keyboard` (`direction: +1` or `-1` in mechanical coordinates). Pointer motion would use move/turn followed by release; endpoint buttons and arrow commands settle through the same mechanical release function. Lock/unlock is a turn command. This is a seam for Phase 2, not yet wired into browser events.

For an existing integration that already applies the mechanical functions, use:

```js
const inputs = readControlInputs(manifest, acceptedStates, previousDetents, commitIds);
```

Supply `commitIds` only after accepted release/endpoint/keyboard settlement. The first read with no `previousDetents` seeds exact initial endpoints; an initial intermediate detent is unassigned (`null`). Subsequent reads preserve the last committed suction/foam/selector mode while visuals move. A locked foam handle retains its exact position and last mode; release does not snap it. Unassigned suction is fail-closed and is listed in `unassignedModes`. HALE PRIME always returns inactive. OFF/RUN/START remain physically persistent. Neither engine requests nor foam modes operate any hydraulic/engine subsystem here.

## Solver API and diagnostics

```js
import { validateProfile } from './src/simulation/config.js';
import { solveNetwork } from './src/simulation/network.js';

validateProfile(profile, { manifest });
const result = solveNetwork(profile, {
  openings: frame.inputs.openings,
  speedRatio: 0.75,                // explicit scenario-imposed drive
  tankVolumeM3: 0.5,
  pickupWet: true,
  externalAvailable: false,
  pumpLiquid: 'filled',           // explicit setup, never inferred prime
});
```

Internally, flow is m³/s, pressure is Pa gauge, head/elevation are meters, volume is m³ and time is seconds. `units.js` provides tested US gallon, US GPM and PSI conversions using fixed water density 1000 kg/m³ and gravity 9.80665 m/s². Returned discharge head is piezometric; gauge pressure subtracts the configured discharge gauge elevation. Pump curve ordinates are total head under the explicit negligible velocity-head approximation.

The outer bisection varies forward pump flow within the curve domain scaled by speed and the source capacity at the configured minimum suction head. An inner bisection finds suction head so source flows sum to pump flow. The solver adds affinity-scaled pump head, computes parallel outlet/return demand, and checks both continuity residuals and the head equation. Both loops are bounded to 48 iterations in the generic preset. It does not extrapolate curves or reuse a previous solution when the bracket fails. Extremely low suction limits are mathematical source-domain limits only; there is no cavitation model.

Successful `status` is `flowing`, `deadhead` (running), `passive`, `stoppedStatic` or `stoppedIsolated`. An isolated stopped discharge has unavailable pressure (`null`). Missing usable liquid source gives `noSupply`; a dry/supply-lost pump gives `unprimed`; invalid inputs, out-of-curve/source domain and excessive residuals have explicit failures with `ok: false` and `flows: null`. Callers must check `ok` before using flow/head readings. Negative gauge pressure may be calculated within the configured mathematical domain; no real-pump NPSH claim is made.

`flows` distinguishes tank outflow, external intake, tank return, delivered outlet flow, individual sources and individual outlets. `lines[id]` is an **assumed tap immediately after the panel valve, at the configured outlet elevation**; downstream hose/nozzle losses are excluded from that tap's pressure. This simplified tap location is not a B54 instrument assignment. A connected closed nozzle/cap has zero flow and static connected pressure. A closed panel valve marks downstream pressure isolated/unavailable, without inventing a trapped-pressure value.

Setting an optional `pump.ratingPa` creates `dischargeRatingExceeded` when the raw gauge reading exceeds it. Pressure is never clamped. The generic preset has no equipment rating; the 220 PSIG threshold is exercised only in a named synthetic test, independent of the B54 record.

## Fixed steps, reset and water accounting

```js
import { createSimulationState, stepSimulation } from './src/simulation/step.js';

let state = createSimulationState(profile, {
  id: 'filled-generic-exercise', version: '1',
  tankVolumeM3: 0.5, pickupWet: true,
  speedRatio: 0.75, pumpLiquid: 'filled', externalAvailable: false,
});
state = stepSimulation(profile, state, { openings: frame.inputs.openings });
```

`stepSimulation` consumes the configured 0.02-second tick; there is no browser scheduler, render-time accumulator, hidden-tab handler or speed-lag model yet. Speed is imposed directly by the scenario, or explicitly overridden through `commands.speedRatio`. A future exercise can deliberately choose to map `speedDemand` to scenario speed. The selector does not secretly start/stop the scenario drive.

Rates and the tank head are held constant within each tick segment (a first-order volume integration approximation). If usable volume reaches the pickup boundary, integrate only that segment, latch `pickupWet: false` and re-solve. If capacity is reached, re-solve the remainder with overflow of net inflow. Full tanks still recirculate. External intake/return can refill a tank with a dry pickup, but cannot automatically re-wet that pickup; only explicit scenario reinitialization does so in Phase 1. The pump's scenario liquid state never primes itself. There is no pump/hose storage ledger because the setup assumes already-filled incompressible paths.

Every cumulative ledger separates `tankOutM3`, `returnM3`, `externalIntakeM3`, `deliveredM3`, `overflowM3` and `pumpThroughM3`. Unsupported `directFillM3` and `drainM3` remain zero. The global mass error is:

```text
Vcurrent - Vinitial - externalIntake - directFill + delivered + overflow + drain
```

Internal recirculation never inflates external input or delivered water. `lastSolve` is a fresh endpoint reading, so a tank that depleted within the tick does not report the previous positive flow as current. A numerical/domain failure rolls back the entire attempted tick, including any partial segment, retains the original tick/time/volume/ledger, and reports `tickSuspended`. No-supply/unprimed states advance time with zero water transfer; they remain explicit unavailable hydraulic results. Inputs are never mutated.

Creating a fresh physical state restarts the scenario. Resetting/recreating a control frame alone cannot restore tank water. Pausing headless replay means making no step calls. The test suite checks identical tick-indexed traces under different batching; rendered 30/60/144 Hz timing, hidden-tab behavior and browser gesture wiring remain Phase 2 work.

## Verification coverage

The suite covers independent one-line/two-line/half-speed answers; running deadhead; passive external pressure; table endpoint roundoff; Darcy and nozzle units; explicit closed/static/isolated lines; all supported profile modes and rejected unsupported policies; exact lock and reverse mappings; discrete commitment; malformed/nonfinite inputs; dry/full boundaries; simultaneous finite sources; ten-minute conservation; rollback; and deterministic replay. A bounded input sweep additionally checks finite outputs and continuity under varied openings/speed. Original GLB, camera and control regression tests run unchanged.

Acceptance targets remain those in the plan: analytic fixture relative error within 1e-6, continuity within max(1e-9 m³/s, 1e-6 × reference flow), head residual within 1e-4 m, and integrated ledger error below 0.01% of initial stored water plus external input, with a one-liter denominator floor. These verify software consistency, not B54 hydraulic accuracy.
