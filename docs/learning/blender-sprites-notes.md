# Blender sprites notes

What I had to learn to read and change `tools/blender/make_sprites.py`, in the order the script uses each idea. The facts about the feature are in [../sprites.md](../sprites.md). This file is what I had to figure out.

These notes are written for Blender 5.2 LTS, the version I render with. I haven't tried older versions. Blender's Python API changes between versions, so when a line below doesn't match the script, the script on disk is right. The official references: the [Python API](https://docs.blender.org/api/current/), [`bpy.types.Driver`](https://docs.blender.org/api/current/bpy.types.Driver.html), [`bpy.types.Depsgraph`](https://docs.blender.org/api/current/bpy.types.Depsgraph.html), [`bmesh.ops`](https://docs.blender.org/api/current/bmesh.ops.html), [`mathutils`](https://docs.blender.org/api/current/mathutils.html) and the [command line arguments](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html).

## What I learned

- The script never opens Blender's window. It builds a scene out of code, renders it, and writes files, the way the game builds a frame out of code.
- Everything in Blender is a data block (an object, a mesh, a material, a collection) with a name, held in `bpy.data`. Making a thing is: create the block, fill it in, link it into the scene.
- Cameras, lights, rotations and render settings all have exact numbers. There is no eyeballing, so I can reproduce a sprite exactly.
- The game's coordinates and Blender's are different, and every conversion between them is a place for a bug. The script keeps all of them in a few spots.

## Running Blender with no window

```bash
cd Breakaway
blender -b --factory-startup -P tools/blender/make_sprites.py -- --out assets/sprites
```

- `-b` is background mode: no window.
- `--factory-startup` ignores my own Blender settings and add-ons, so the script runs on a clean Blender.
- `-P` runs a Python file.
- Blender reads its own options up to `--` and ignores the rest, so the script finds its options after it:

```python
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser(description="Render the Breakaway sprite sheets.")
parser.add_argument("--out", default=None, help="output folder (default: see default_out_dir)")
parser.add_argument("--samples", type=int, default=SAMPLES, help="Cycles samples per pixel")
```

Compared to the game: the game gets its options from the URL (`?seed=`, `?sprites=off`). This is the same idea for a command line.

Watch out: `import bpy` only works inside Blender. Running the file with plain `python3` fails with `No module named 'bpy'`.

Experiment: run it with `--samples 8`, then with `--samples 128`, and compare the edges of the skater in `skater.png` and how long it takes.

## Running it inside Blender

The same script runs from Blender's **Scripting** tab: **Text > Open**, then **Run Script** (Alt+P). Two things differ from the command line:

- There is no `--` in `sys.argv`, so `parse_args()` gets no options and every default applies. The settings block at the top of the script is where I change things.
- `__file__` isn't the file's path. For a text in the Text Editor, Blender sets it to the `.blend` file's path plus the text's name, so the script asks the Text Editor instead:

```python
path = os.path.abspath(globals().get("__file__", ""))
if os.path.isfile(path):
    return path
text = getattr(getattr(bpy.context, "space_data", None), "text", None)
if text is not None and text.filepath:
    return os.path.abspath(bpy.path.abspath(text.filepath))
```

`bpy.context.space_data` is the editor the script runs from. In background mode there is none, so the `getattr` chain returns `None` instead of failing.

Compared to the game: like the difference between the page and the Node tests. The same functions run in both, but what's around them (a window, the arguments, the file path) changes.

Watch out: Blender's interface freezes while it renders. On Windows, **Window > Toggle System Console** shows the `print()` lines and the full error text; the status bar only shows the last line.

Experiment: after a run, pick `bk_sprites` in the scene list, press Numpad 0 for the camera view, select `bk_skater0_root` and drag its `phase` custom property (Object properties, Custom Properties). The legs follow the drivers.

## bpy.data, bpy.ops and bpy.context

- `bpy.data` is the storage: every object, mesh and material by name. `bpy.data.objects.new(...)` creates a block directly. This is what the script uses almost everywhere.
- `bpy.ops` are the same commands the menus run, such as render. They depend on the current state ("the active object"), which is why they can fail with "context is incorrect".
- `bpy.context` is that current state: the active scene, object and so on.

Two lines from the script, with my comments added:

```python
mesh = bpy.data.meshes.new(PREFIX + name)         # data: no context needed
...
bpy.ops.render.render(write_still=True, scene=scene.name)   # ops: acts like a menu command
```

Compared to the game: `bpy.data` is like the game state object I pass around; `bpy.context` is like a global I would rather not rely on. I pass things in as arguments, the same as `main.js` does.

Watch out: the script only uses `bpy.ops` for rendering and saving the `.blend`, where there is no `bpy.data` way. Everything else is data.

Experiment: add `print(len(bpy.data.objects))` at the end of `main()` and run twice with `--blend`. The count should be the same each time, because of the clean-up described further down.

## Units and axes

One Blender unit is one game foot, so a 5 ft cell is 5 units. Sprites face +X, which is angle 0 on the canvas. The camera looks straight down the Z axis, so Blender's X and Y become the picture's horizontal and vertical. Blender +Y points up in the picture, but canvas y points down, so Blender +Y is canvas -y.

```python
points.append({"x": round(at.x - root.location.x, 3), "y": round(-at.y, 3)})
```

That `-at.y` is the only axis flip when reading the hand point back. The goalie dive points toward Blender -Y, which is canvas +y, which is why `side_pose_y` is `1`.

Compared to the game: the canvas has y down and angle 0 along +x, turning toward +y. Blender has Z up and y up in the picture.

Watch out: a picture that comes out mirrored is almost always a missing or doubled `-`.

Experiment: change the glove `y` flip to `at.y` (no minus) and re-render. In the game the stick line would start at the wrong shoulder side. Change it back.

## sRGB hex to linear color

Hex colors like `#0b3d91` are sRGB, which stores brightness so that dark colors get more steps. Blender's materials and lights work in linear light, where doubling a number doubles the light. If I put the sRGB numbers in directly, everything comes out too light and washed out.

```python
value = hex_color.lstrip("#")
channels = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
return (*linear, 1.0)
```

Compared to the game: Canvas takes `#0b3d91` as it is, because Canvas works in sRGB. The conversion is only needed because the renderer does light maths.

Watch out: the output is converted back to sRGB when the PNG is saved, but only if the view transform is Standard (see the scene). Together they make the PNG's colors match the hex.

Experiment: skip the conversion (return the raw `channels`) and look at the jersey. It becomes lighter than `#0b3d91`.

## The scene

```python
scene = bpy.data.scenes.new(PREFIX + "sprites")
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = samples
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"
```

- Cycles is Blender's ray tracer. It follows rays of light, so shadows and shading come out right. A sample is one ray per pixel; more samples give less noise, and the denoiser smooths what is left.
- `device = "CPU"` means no graphics card is needed, so it runs on any machine, slower.
- `film_transparent` drops the background so the PNG has an alpha channel and the ice shows behind it in the game.
- The view transform is how Blender turns light into screen colors. Newer Blender defaults to AgX, which lowers contrast on purpose to look filmic. I want my hex colors back, so I use Standard.

Compared to the game: Canvas draws a shape in one call. Cycles takes seconds per picture because it simulates light, and I only pay that once, when I make the sheets.

Watch out: a PNG with dull, grayish colors means the view transform is not Standard.

Experiment: set `view_transform` to `"AgX"` and re-render the puck. Compare its black with the Standard one.

## The world light

```python
background.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
background.inputs["Strength"].default_value = WORLD_STRENGTH
scene.world = world
```

The world is the sky around the scene. A white world lights everything softly from all sides, so the sides of the shapes don't go black. The sun (`SUN_STRENGTH`, `SUN_ANGLE_DEG`) adds one direction of light, and the shadows. With `film_transparent` the sky doesn't show in the PNG, only its light does.

Compared to the game: in Canvas I fake this with a darker shade on one side of a shape. Here the light does it.

Watch out: a new world may or may not come with a node tree, depending on the Blender version, so the script checks and builds one when it's missing.

Experiment: set `WORLD_STRENGTH` to `0.0` and `SUN_STRENGTH` to `4.0`. The top faces get brighter and the sides get dark.

## Materials and the Principled BSDF

A material is a small graph of nodes. The Principled BSDF node is the all-purpose surface: base color, roughness and metallic.

```python
bsdf.inputs["Base Color"].default_value = hex_to_linear(hex_color)
bsdf.inputs["Roughness"].default_value = ROUGHNESS.get(name, 0.65)
bsdf.inputs["Metallic"].default_value = METALLIC.get(name, 0.0)
```

Roughness 0 is a mirror and 1 is chalk. Metallic 1 is a metal, which takes its color from the base color and reflects the sky. I use it only for the skate blades (`0.8`).

Compared to the game: `ctx.fillStyle = color` is the whole material in Canvas. Here the same color also decides how shiny the surface is.

Watch out: the node's input names (`"Base Color"`) are text, so a typo is a runtime error.

Experiment: set the helmet's roughness to `0.1` and look for a bright reflection on top of the helmet.

The puck taught me one more input. Its top is flat and faces straight up, and the sun and the camera both sit straight above it, so the top reflects the sun right into the camera and my black puck came out gray. Every non-metal reflects a little light, set by **Specular IOR Level** (0.5 is normal). The script lowers it for the puck only:

```python
if "Specular IOR Level" in bsdf.inputs:
    bsdf.inputs["Specular IOR Level"].default_value = SPECULAR.get(name, 0.5)
```

The `in` check keeps the script safe on a Blender where the input has another name.

## Collections and the bk_ clean-up

A collection is a folder of objects. The script has one per strip (`bk_skater`, `bk_goalie`, `bk_puck`) and one for the stage. Every name it makes starts with `bk_`.

```python
for blocks in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.lights,
               bpy.data.cameras, bpy.data.collections, bpy.data.worlds):
    for block in [b for b in blocks if b.name.startswith(PREFIX)]:
        blocks.remove(block)
```

Every run first removes everything that starts with `bk_`, so running the script twice (or on a saved `.blend`) doesn't pile up duplicates, and it never touches things that aren't mine.

Compared to the game: like clearing the canvas before drawing a frame, but for the scene.

Watch out: the list is copied (`[... for ...]`) before removing, because removing from a list while looping over it skips items.

Experiment: in Blender's Text Editor, run the script twice and look at the Outliner: still one set of `bk_` objects. Change `PREFIX` to `"bk2_"` and run again: now there are two sets. Change it back.

One more case: if I'm looking at the `bk_sprites` scene when I run it again, the script first switches the window back to another scene, because it's about to delete the one on screen.

## Objects, meshes, empties and parenting

- A mesh is the shape (points and faces). An object is a mesh with a place, rotation and scale. An empty is an object with no mesh, only a place, used as a joint.
- Parenting: a child's location and rotation are in its parent's space (local space), and it moves with the parent. Its place in the scene (world space) is the parent's transform applied to it.

```python
collection.objects.link(obj)
obj.parent = parent
obj.location = location
obj.rotation_euler = rotation
```

That is the script's `link()`. The hip is an empty at the top of the leg, and the thigh, shin, boot and blade are its children, so turning the hip swings the whole leg.

Compared to the game: this is `ctx.save()`, `translate`, `rotate`, draw, `ctx.restore()`, as a tree that stays. A child is drawn inside its parent's transform, which is exactly what Canvas does for what I draw between `save` and `restore`.

Watch out: setting `obj.parent` does not undo the parent's transform. The location I give is already local.

Experiment: in `build_skater`, change a hip's location from `side * 0.45` to `side * 0.9`, and see the legs spread wider.

## bmesh primitives

`bmesh` builds a mesh in memory. The script uses three shapes.

```python
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)
return add_mesh_object(name, finish_mesh(name, bm, True), material, collection, parent, center, scale=radii)
```

- A UV sphere with radius 1, then the object's scale set to three different radii, becomes an ellipsoid. Almost every body part is this: torso, helmet, boots, gloves.
- A cube (`create_cube`, `size=1.0`) scaled to the size I want, plus a Bevel modifier that rounds the edges: pads, blades, blocker, stick.
- The puck is a cone with both radii equal and `depth` as the thickness, which is a cylinder, with a Bevel.

`finish_mesh()` copies the bmesh into a real mesh, frees the bmesh, and turns on smooth shading when asked.

Compared to the game: Canvas has `ellipse()` and `rect()`. This is the 3D version, and "scale a unit shape" is what I do with `ctx.scale()` before drawing a circle to get an ellipse.

Watch out: `bm.free()` matters. A bmesh that isn't freed leaks memory.

Experiment: change `u_segments=24` to `6` in `add_ellipsoid`. The helmet becomes visibly faceted.

## Pointing a limb with to_track_quat

`add_limb` stretches an ellipsoid to run from a start point to an end point. The ellipsoid's long axis is X, so it needs to be turned so X points along the limb.

```python
axis = end - start
obj = add_ellipsoid(name, collection, parent, (start + end) / 2,
                    (axis.length / 2 + radius * 0.6, radius, radius), material)
obj.rotation_mode = "QUATERNION"
obj.rotation_quaternion = axis.to_track_quat("X", "Y" if abs(axis.normalized().z) > 0.9 else "Z")
```

- The center is halfway, and the length is half the distance plus a little, so joints overlap.
- `to_track_quat("X", "Z")` returns the rotation that points the X axis along `axis` and keeps Z roughly up. A quaternion is a rotation stored as four numbers, which avoids the odd turns Euler angles can make.
- When the limb points almost straight up or down, "keep Z up" is unclear, so the script uses Y as the up axis.

Compared to the game: in Canvas I'd use `Math.atan2(dy, dx)` and `rotate`. `to_track_quat` is `atan2` for 3D.

Watch out: the up axis can't be the same as the tracking axis, and it can't be parallel to `axis`, or the rotation is undefined. That is why the 0.9 test exists.

Experiment: change the shin's end point from `(0, 0, -1.75)` to `(0.5, 0, -1.75)`. The shin tilts, and the boot, which isn't part of the shin, stays where it was.

## Custom properties and drivers

The skater's legs are not keyframed. Each frame's root empty has a custom property, `phase`, and each hip's rotation is a driver: a formula that reads `phase`.

```python
root["phase"] = phase
...
driver = obj.driver_add("rotation_euler", axis_index).driver
driver.type = "SCRIPTED"
variable = driver.variables.new()
variable.targets[0].id = root
variable.targets[0].data_path = '["phase"]'
driver.expression = expression
```

- A custom property is a named number stuck to an object (`root["phase"]`).
- A driver makes another property follow a formula. Here the formula is something like `0.785 * max(0, sin(phase + 0.0))`. It's a simple expression: only numbers, `sin` and `max`, which Blender can evaluate without running arbitrary Python.
- Drivers instead of keyframes because each frame is a separate skater at a different phase, standing side by side. There is no timeline to animate along, only eight copies that differ in one number.

Compared to the game: `getSkaterFrame()` picks a frame from the distance skated. Here `phase` plays the same role while building the frames: the stride position as a single number.

Watch out: a driver's value is only recalculated when Blender updates the scene (see the depsgraph section), so reading the result right after setting things up can give the old number.

Experiment: set `root["phase"] = 0.0` for every frame (pass `0.0` in `main()`). All eight frames come out identical.

## The stride cycle math

Eight frames cover one full cycle of `2π`, so frame `i` has phase `2π × i / 8`. The two legs are half a cycle (`π`) apart, so when one pushes, the other recovers.

```python
push = f"max(0, sin(phase + {phase_shift:.6f}))"
add_phase_driver(hip, 0, root, f"{side * push_out:.6f} * {push}")
add_phase_driver(hip, 1, root, f"{push_back:.6f} * {push}")
add_phase_driver(hip, 2, root, f"{side * toe_out:.6f} * {push}")
```

- `sin(phase)` swings between -1 and 1. `max(0, ...)` cuts off the negative half, so a leg only pushes (swings out, back and turns its toe) during half the cycle, and rests at 0 for the other half.
- The three drivers use the same `push` value, scaled by `LEG_PUSH_OUT_DEG`, `LEG_PUSH_BACK_DEG` and `SKATE_TOE_OUT_DEG`, so the leg's three motions stay in step.
- The shoulders sway with `sin(phase)` alone, so they swing both ways.
- In the game, one full cycle is `stride_length_ft` (7 ft) of skating, so the legs match the ground passing under the skater.

Compared to the game: `sin` is the same one I'd use for a bobbing animation on a timer. Here the timer is distance instead of time.

Watch out: the angles in the formulas are in radians, which is why the script wraps the degree settings in `math.radians`.

Experiment: set `LEG_PUSH_OUT_DEG` to `90` and look at frame 2 (a quarter of the way through the cycle).

## Goalie poses as data

Each goalie pose is a dictionary of numbers (`GOALIE_POSES`), and one function, `build_goalie`, builds any of them.

```python
"butterfly": {"reach_ft": 2.3, "hip_z_ft": 0.9, "knee_z_ft": 0.35, "knee_gap_ft": 0.3,
              "pad_flare_deg": 82, "lean_deg": 5, "side_lean_deg": 0, "stick_reach_ft": 1.1},
```

- `hip_z_ft` and `knee_z_ft` are heights: a butterfly drops the hips and knees close to the ice.
- `pad_flare_deg` turns the pads outward at the knee: 82 degrees is nearly flat.
- `lean_deg` leans forward and `side_lean_deg` leans sideways.
- `reach_ft` goes into `sprites.json`, and the game scales the sprite by it.

For the dive, the whole body hangs from a `body` empty that is rolled `DIVE_ROLL_DEG` (80) around X and lifted `DIVE_LIFT_FT`, so the goalie lies on their side. Every part is a child of `body`, so the pose is built upright and rolled as one piece.

Compared to the game: the game keeps its tuning numbers in `constants.js` instead of inside functions; this is the same idea with pose numbers, so a new pose is a new dictionary entry.

Watch out: if I add a pose, the game's `GOALIE_SPRITE_POSES` and the pose-for-mode table also need it, or `validateSpriteManifest` rejects the file.

Experiment: change `DIVE_ROLL_DEG` from `80` to `40` and look at the dive cell.

## body_point

The blocker hand sits on the upper body, which is tilted by the lean. The stick shaft belongs to `body`, which isn't tilted. To start the shaft at the hand, I need the hand's place in the body's space.

```python
def body_point(origin, rotation, local):
    return Vector(origin) + Euler(rotation, "XYZ").to_matrix() @ Vector(local)
```

Read it right to left: take the point in the tilted frame (`local`), turn it by the frame's rotation (`Euler(...).to_matrix() @ local`), then move it by the frame's origin (`origin +`). `@` is matrix times vector in Python.

Compared to the game: this is the same maths as `drawSkaterSprite`, which turns the hand point by the skater's facing before adding the position.

Watch out: the Euler order must match the order Blender uses for that object (`"XYZ"` by default).

Experiment: make `body_point` return just `Vector(origin) + Vector(local)`. For a leaning pose, the stick will no longer meet the blocker.

## The orthographic camera and ortho_scale

A perspective camera makes far things smaller. An orthographic camera doesn't, which is what a top-down game needs: a skater's size doesn't depend on its height. Its `ortho_scale` is the width of what it sees, in Blender units.

```python
camera.data.ortho_scale = columns * cell_ft
scene.render.resolution_x = columns * cell_px
scene.render.resolution_y = cell_px
```

With the strip `columns × cell_ft` feet wide and `columns × cell_px` pixels wide, one cell is exactly `cell_ft` feet and `cell_px` pixels. That is the promise `sprites.json` makes, and the game draws a cell `cell_size_ft` feet across.

Compared to the game: the renderer's feet-to-pixels transform. This is the reverse direction: I choose how many pixels per foot (`128 / 5 = 25.6` for the skater).

Watch out: change a cell size in the script and the game follows without a code change, but the PNG must be re-rendered.

Experiment: set `SKATER_CELL_PX` to `64`. The skater is half as sharp and `sprites.json` says so. The game draws it the same size.

## cell_offsets and one render per strip

The eight skaters stand in a row, one cell apart and centered on the camera, so one render makes the whole strip.

```python
def cell_offsets(count, cell_ft):
    return [(i - (count - 1) / 2) * cell_ft for i in range(count)]
```

For 8 cells of 5 ft: `-17.5, -12.5, ... 17.5`. The row is centered at x = 0, where the camera is, and the camera's `ortho_scale` covers exactly the row.

Compared to the game: `getCellRect` in the game goes the other way: from a frame number back to the pixel rectangle.

Watch out: the hand point is `glove.x - root.x`, which is relative to the skater, not to the strip.

Experiment: change `cell_offsets` to use `cell_ft * 1.2`. The characters spread, and the PNG shows empty bands between cells that the game would read as the wrong cell.

## Hiding collections per render

All three strips live in the same scene, at the same place, so at render time the script shows one and hides the others.

```python
for strip_name, collection in strips.items():
    collection.hide_render = strip_name != name
```

Compared to the game: like drawing only the layer I want into a given canvas.

Watch out: `hide_render` only affects rendering. In the Blender window (when I open the `.blend`), all three still show on top of each other. Hide the collections there to see one.

Experiment: comment out the line and render. All three characters appear in every PNG.

## The depsgraph and evaluated objects

Blender keeps the original data and a calculated copy: the depsgraph holds the evaluated scene, where drivers, modifiers and parenting have already been worked out. `obj.location` is the stored number; the evaluated copy knows where the object really is.

```python
view_layer.update()
depsgraph = view_layer.depsgraph
at = glove.evaluated_get(depsgraph).matrix_world.translation
```

- `view_layer.update()` makes Blender recalculate, so the drivers have run.
- `evaluated_get(depsgraph)` gives the object as calculated.
- `matrix_world.translation` is its place in world space, after the hip, the lean and the parent chain.

This is how the script finds out where the glove ended up, without doing the leg maths a second time in Python.

Compared to the game: the renderer blends previous and current positions with `alpha`. The stored values are one thing, what ends up on screen is another.

Watch out: reading `glove.matrix_world` straight from the original object can give the position from before the drivers ran, so the hand points would all be the same.

Experiment: remove `.evaluated_get(depsgraph)` and see how `hand_ft` in `sprites.json` changes.

## The shadow catcher

```python
catcher = link(bpy.data.objects.new(PREFIX + "ice", ice), collection)
catcher.is_shadow_catcher = True
```

The ice is a flat plane under the characters. As a shadow catcher it is invisible in the render, but it shows the shadows that fall on it, as darkening on the transparent PNG. In the game, the ice is whatever the rink layer draws, and the shadow lies on top of it. `IS_SHADOW_ON` switches it off.

Compared to the game: in Canvas, a shadow is something I have to draw myself. Here it comes from the sun's direction and is baked into the PNG.

Watch out: shadows are soft because the sun has an angle (`SUN_ANGLE_DEG`). A shadow is cut off at the cell edge, so a big shadow needs a bigger cell.

Experiment: set `IS_SHADOW_ON = False` and compare the puck's PNG.

## Cleaning the edges with numpy

My first real render had a faint gray square around every player in the game. The shadow catcher also records a very faint shadow far from each character (the character blocks a little of the sky light even a few feet away), and the cell's square edge cut that faint shadow off in a straight line. `clean_alpha()` fixes it after each render by changing only the alpha channel:

```python
alpha = numpy.clip((rgba[:, :, 3] - FAINT_SHADOW_ALPHA) / (1 - FAINT_SHADOW_ALPHA), 0, 1)
x = numpy.arange(width) % cell_px
y = numpy.arange(height) % cell_px
fade_x = numpy.minimum(numpy.minimum(x, cell_px - 1 - x) / CELL_EDGE_FADE_PX, 1)
fade_y = numpy.minimum(numpy.minimum(y, cell_px - 1 - y) / CELL_EDGE_FADE_PX, 1)
rgba[:, :, 3] = alpha * numpy.minimum.outer(fade_y, fade_x)
```

- The first line maps alpha 0.06 to 0 and 1 to 1 in a straight line. Anything fainter than 0.06 disappears, and there is no jump where it starts.
- `% cell_px` gives each pixel's position inside its own cell, so one line of math handles every cell in the strip.
- `numpy.minimum.outer` builds a whole-image grid from a column of row values and a row of column values: the fade is 0 on every cell border and 1 from 3 pixels in.
- `image.pixels` is one flat list of floats (red, green, blue, alpha, then the next pixel), starting from the bottom row. `foreach_get` and `foreach_set` copy it in one call, which is much faster than a Python loop over half a million values.

Compared to the game: like editing `ImageData` from `getImageData()` in Canvas, which is also one flat RGBA array, but numpy does the whole array in one expression instead of a `for` loop.

Watch out: Blender ships numpy with its own Python, so `import numpy` works inside Blender even if it isn't installed anywhere else.

Experiment: set `FAINT_SHADOW_ALPHA = 0`, re-render, and look at the skater in the game: the gray square comes back.

## sprites.json and why the game validates it

The script writes what the game needs to use the PNGs: cell sizes, grid, frame order, the hand points, the goalie poses and their reach. It is written by `json.dump` from `build_manifest()`.

```python
"skater": {
    "file": "skater.png",
    "cell_size_ft": SKATER_CELL_FT,
    "cell_size_px": SKATER_CELL_PX,
    "columns": STRIDE_FRAMES,
    "hand_ft": hand_points,
```

The numbers come from the same constants that drove the render, so the file can't disagree with the pictures. The game still doesn't trust it: `validateSpriteManifest` checks every field, because the file is data from outside the code, and a wrong cell size or an index past the end would draw garbage, or a huge sheet. Anything wrong means the shapes stay.

Compared to the game: `settings.js` does the same for saved settings. Anything read from outside the program gets checked first.

Watch out: if I change what `sprites.json` contains, `schema_version` and the validator have to change together.

Experiment: after a render, change `"columns": 8` to `9` in `sprites.json` by hand, and load the game with sprites on. It falls back to shapes, because the PNG is not as wide as 9 cells.

## Saving a .blend to inspect

```bash
cd Breakaway
blender -b --factory-startup -P tools/blender/make_sprites.py -- --out assets/sprites --blend sprites.blend
```

`--blend` calls `bpy.ops.wm.save_as_mainfile(filepath=..., copy=True)`. `copy=True` saves a copy and leaves the running session alone. Opening the file in Blender shows the real scene with every rig, so I can click a hip and watch its driver, or move the camera.

Watch out: the render collection visibility from the last render (`puck`) is saved with it, so the skater collection shows as hidden. Turn on the eye icon in the outliner.

Experiment: open the `.blend`, select a hip empty (`bk_skater3_left_hip`), and look at its Rotation fields: they are purple, which is the sign of a driver. Change `bk_skater3_root`'s `phase` custom property in the Object properties and see the leg move.

## Check myself

1. Why does the script use `bpy.data` for nearly everything and `bpy.ops` only for rendering and saving?
2. Blender +Y is which canvas direction, and where does the script flip it?
3. Why does `hex_to_linear` exist, and what would the PNG look like without it?
4. What does `max(0, sin(phase))` do to a leg, and why are the two legs `π` apart?
5. Why does `remove_previous_run` copy the list before removing items?
6. What is `ortho_scale` set to for the goalie strip, and what does that give for feet per pixel?
7. Why are drivers used instead of keyframes for the stride?
8. Why does `read_hand_points` call `view_layer.update()` and `evaluated_get(depsgraph)`?
9. What does `body_point` return, and why is it needed for the stick shaft?
10. Why does the game check `sprites.json` when the script just wrote it?
11. Why did a faint gray square show around each player, and why does `clean_alpha()` subtract `FAINT_SHADOW_ALPHA` instead of just setting low values to 0?

## Changelog

- 2026-11-05: Wrote these notes while reading the Blender sprite script.
- 2026-11-05: Added cleaning the edges with numpy and the puck's Specular IOR Level, after my first real render.
- 2026-11-05: Added running the script inside Blender (the Text Editor, `__file__`, `script_file()`) and the clean-up experiment in the Text Editor. Written for Blender 5.2 LTS.
