# B54 model source

`b54.blend` is the editable photo-informed Blender model. `../scripts/build_b54_model.py` reproduces the source, the browser asset at `../public/models/b54.glb`, its control contract, and three local QA renders in `../.qa/b54/`.

Run from the repository root in PowerShell:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/build_b54_model.py
```

Requires Blender 5.2; uses only its bundled Python and stock glTF exporter. No downloaded assets, external Python modules, raw photo textures, or generated raster textures. All markings are authored mesh lettering. The input photographs remain in the ignored `Pictures/B54` directory and are not needed to rerun the generator.

The Blender axes are X right when looking at the rear, Y toward the front, Z up. The exported GLB is X right at the rear, Y up, Z toward the rear. Units are approximate meters. Cab details, dimensions, hardware, tools, tread and diamond plate are stylized. The panel layout is based on the actual photographs. Gauges are static illustrations and their displayed readings do not indicate operating data. There is no hydraulic simulation and no invented concealed pump mechanism.

Read `b54-controls.json` before adding interaction. Each named `ctrl_*` empty is a movable parent with its handle, label and visible shaft beneath it. Preserve the original translation and quaternion. Add translation offsets in the exported parent basis; rotating a handle must not rotate its slider axis. Roots have unit scale and identity rotation in the GLB. Outward pull is +Z, horizontal right is +X, and rotation toward the viewer is +Z. All transforms in the manifest are offsets from the exported rest pose. Descendant hits should resolve to the closest `controlId` ancestor.

Locks are positive: preserve exact extension and reject every push/pull or sliding update while locked. The specified quarter-turn lock angles and approximate 0.6 m pull travel are visual conventions, not measurements. Tank valve direction is reversed: pull closes. Its lock mechanics remain provisional. HALE PRIME must remain inactive. Suction has only left/closed and right/open states. Foam has left/prime, center/off, right/operate positions. Throttle positive rotation is counterclockwise from the rear and increases/open; its one-turn range is provisional. Engine selector has three stable positions and no spring return.

The source `.blend` and GLB omit the QA stage, lights, and cameras. The manifest contains a suggested rear-panel camera and target. Rendering is done after the source/export are saved.

The user's physical description is authoritative: the pump panel is **flush with the rear**, and the walkway is **on its right**, between the pump housing and the right-side containers. It is not a centered operator cavity. The actual brush photograph `2-1000022220.jpg` informs styling; the engine comparison `1-1000022221.jpg` supplies no rear geometry.

Approximate adjustable dimensions: pump face 0.88 m wide by 1.08 m high, bottom at 1.02 m; overall central span 1.26 m; right walkway 0.38 m wide by 3.10 m long, deck at 1.0 m. Pump center X = -0.19; its right edge X = 0.25 meets the walkway's left edge. The walkway center is X = 0.44, ending at the right containers' inner edge X = 0.63. The pump face and rear compartment ends share exported Z = 3.22. The pump housing and hose beds extend forward from this flush face, leaving the right-side passage open. These dimensions are approximate, not measured. Source parameters expose the widths and height; deck length is derived directly from the silver toolbox front. The toolbox spans exported Z = 0.12 to 3.14 (3.02 m); the continuous deck spans Z = 0.12 to 3.22, including the rear entry. The body is split around the passage, its underfloor is below the walking surface, and both passage walls continue to the toolbox front. The former short forward end wall is removed and relocated to that front endpoint.

The complete top booster assembly now runs on a fore/aft spindle (exported Z axis), with both flanges, hub, wound hose, supports and visible outlet routing aligned accordingly. The hose pays **left, exported -X when viewing the rear**. The visible hose leads over the left side; `boosterReel` metadata documents the axis, payout vector and routing node. This orientation follows the user's correction; support and hose-route shapes are approximate.

All 13 control-root rotations/scales remain identity/unit in the GLB, and 12 controls remain active. Axial 0.6 m strokes and user-confirmed mechanisms are preserved. Extended grips intentionally project beyond the flush rear boundary; there is no centered-recess containment requirement. Lateral suction/foam ranges match their resized tracks. The validator checks the actual flush alignment, right-walkway placement, fore/aft reel axis, and rearward extension rather than the superseded cavity interpretation.

`rearPanel.bounds` describes the backing in exported coordinates. `rearBay` describes only the right-side walkway. The suggested pump camera is centered on the left-offset face. QA views include `straightrear.png`, `walkway.png` (elevated right passage), `top_reel.png`, `top_overview.png`, `panel.png`, `rear.png`, and `front.png`.

Validate with `node scripts/validate_b54_model.mjs`. No source photographs are embedded or served.

The three hose-bed lanes now span the full pump assembly width. Their outer divider edges and support deck align at exported X = -0.63 and +0.25, eliminating the old unused left strip. Four divider plates define three distinct lanes; hose stacks and nozzles are centered in those lanes, with small clearances from the walls. The panel backing/deck extends 12.5 mm beyond the structural housing side on each edge as trim. The right-hand bed edge stops at the walkway boundary. `hoseBeds` metadata documents actual lane spans, and export checks compare the deck/divider/stack geometry to the real pump housing and preserve the passage obstruction checks. Lane widths and hardware clearances remain approximate.

The validator checks all exported mesh bounds against the full-length passage interior (excluding narrow wall/threshold margins and shallow tread relief), in addition to checking that the real deck reaches the full silver toolbox extent. This verifies visible geometry rather than metadata alone; dimensions remain approximate and this is not a human-clearance certification.
