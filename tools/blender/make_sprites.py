"""Breakaway sprite sheets: the skater, goalie and puck rendered top-down.

Builds each character from simple shapes, lines its frames or poses up in a
strip (one cell each) and renders every strip once with Cycles into a
transparent PNG. sprites.json records the cell sizes, the frame order, the
skater's hand point per frame and the goalie's reach per pose, for
src/core/sprites.js.

Run from the Breakaway folder:
    blender -b --factory-startup -P tools/blender/make_sprites.py -- --out assets/sprites
Or open it in Blender's Text Editor and press Run Script. Without --out, the
sheets go to assets/sprites when the script is in tools/blender, otherwise to a
breakaway-sprites folder next to the script (or in the home folder for a text
that was never saved to a file).

1 Blender unit = 1 game foot. The camera looks straight down. Sprites face +X,
which is angle 0 on the game canvas; Blender +Y is canvas -y.
"""

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
import numpy
from mathutils import Euler, Vector

# ------------------------------------------------------------------ settings

OUT_DIR = "assets/sprites"
SAMPLES = 64
SUN_STRENGTH = 2.2
SUN_ANGLE_DEG = 12
WORLD_STRENGTH = 0.3
IS_SHADOW_ON = True
FAINT_SHADOW_ALPHA = 0.06
CELL_EDGE_FADE_PX = 3

COLORS = {
    "jersey": "#0b3d91",
    "stripe": "#eef3f6",
    "helmet": "#eef3f6",
    "visor": "#11161d",
    "pants": "#11161d",
    "glove": "#20252c",
    "skate": "#11161d",
    "blade": "#9ea3a8",
    "goalie_jersey": "#20252c",
    "goalie_helmet": "#c8102e",
    "cage": "#d9dfe4",
    "pad": "#eef3f6",
    "pad_trim": "#c8102e",
    "stick": "#11161d",
    "puck": "#0a0c0f",
}
ROUGHNESS = {"helmet": 0.35, "goalie_helmet": 0.35, "visor": 0.2, "blade": 0.3, "pad": 0.5, "puck": 0.55}
METALLIC = {"blade": 0.8}
SPECULAR = {"puck": 0.1}

SKATER_CELL_FT = 5.0
SKATER_CELL_PX = 128
STRIDE_FRAMES = 8
STRIDE_LENGTH_FT = 7.0
LEG_PUSH_OUT_DEG = 45
LEG_PUSH_BACK_DEG = 30
SKATE_TOE_OUT_DEG = 25
SHOULDER_SWAY_DEG = 8
FORWARD_LEAN_DEG = 20

GOALIE_CELL_FT = 8.0
GOALIE_CELL_PX = 192
GOALIE_POSES = {
    "stance": {"reach_ft": 1.8, "hip_z_ft": 1.9, "knee_z_ft": 1.85, "knee_gap_ft": 0.7,
               "pad_flare_deg": 15, "lean_deg": 10, "side_lean_deg": 0, "stick_reach_ft": 1.2},
    "butterfly": {"reach_ft": 2.3, "hip_z_ft": 0.9, "knee_z_ft": 0.35, "knee_gap_ft": 0.3,
                  "pad_flare_deg": 82, "lean_deg": 5, "side_lean_deg": 0, "stick_reach_ft": 1.1},
    "poke": {"reach_ft": 1.8, "hip_z_ft": 1.8, "knee_z_ft": 1.85, "knee_gap_ft": 0.7,
             "pad_flare_deg": 15, "lean_deg": 30, "side_lean_deg": 0, "stick_reach_ft": 3.0},
    "lean": {"reach_ft": 1.8, "hip_z_ft": 1.9, "knee_z_ft": 1.85, "knee_gap_ft": 0.75,
             "pad_flare_deg": 25, "lean_deg": 10, "side_lean_deg": 18, "stick_reach_ft": 1.2},
    "dive": {"reach_ft": 3.6, "hip_z_ft": 1.9, "knee_z_ft": 1.85, "knee_gap_ft": 0.5,
             "pad_flare_deg": 10, "lean_deg": 0, "side_lean_deg": 0, "stick_reach_ft": 1.2},
}
DIVE_ROLL_DEG = 80
DIVE_LIFT_FT = 1.7

PUCK_CELL_FT = 1.5
PUCK_CELL_PX = 48
PUCK_RADIUS_FT = 0.5
PUCK_THICKNESS_FT = 0.33

PREFIX = "bk_"

# ------------------------------------------------------------------ helpers


def hex_to_linear(hex_color):
    """sRGB hex (#rrggbb) to the linear RGBA that Blender materials use."""
    value = hex_color.lstrip("#")
    channels = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return (*linear, 1.0)


def parse_args():
    """Reads the options after `--` on the Blender command line."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Render the Breakaway sprite sheets.")
    parser.add_argument("--out", default=None, help="output folder (default: see default_out_dir)")
    parser.add_argument("--samples", type=int, default=SAMPLES, help="Cycles samples per pixel")
    parser.add_argument("--blend", default=None, help="also save the scene to this .blend file")
    return parser.parse_args(argv)


def script_file():
    """This script's path, also when it runs from Blender's Text Editor."""
    path = os.path.abspath(globals().get("__file__", ""))
    if os.path.isfile(path):
        return path
    text = getattr(getattr(bpy.context, "space_data", None), "text", None)
    if text is not None and text.filepath:
        return os.path.abspath(bpy.path.abspath(text.filepath))
    return ""


def default_out_dir():
    """assets/sprites in the game folder for tools/blender, else breakaway-sprites next to the script."""
    script = script_file()
    if not script:
        return os.path.join(os.path.expanduser("~"), "breakaway-sprites")
    folder = os.path.dirname(script)
    if os.path.normpath(folder).split(os.sep)[-2:] == ["tools", "blender"]:
        return os.path.normpath(os.path.join(folder, "..", "..", OUT_DIR))
    return os.path.join(folder, "breakaway-sprites")


def body_point(origin, rotation, local):
    """Where a point given in a rotated child frame sits in its parent's frame."""
    return Vector(origin) + Euler(rotation, "XYZ").to_matrix() @ Vector(local)


def cell_offsets(count, cell_ft):
    """X positions that center `count` cells of `cell_ft` on the camera."""
    return [(i - (count - 1) / 2) * cell_ft for i in range(count)]

# ------------------------------------------------------------------ scene


def remove_previous_run():
    """Deletes everything an earlier run made (names start with PREFIX)."""
    window = getattr(bpy.context, "window", None)
    if window is not None and window.scene.name.startswith(PREFIX):
        window.scene = next((s for s in bpy.data.scenes if not s.name.startswith(PREFIX)), None) \
            or bpy.data.scenes.new("Scene")
    for scene in [s for s in bpy.data.scenes if s.name.startswith(PREFIX)]:
        bpy.data.scenes.remove(scene)
    for blocks in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                   bpy.data.cameras, bpy.data.collections, bpy.data.worlds):
        for block in [b for b in blocks if b.name.startswith(PREFIX)]:
            blocks.remove(block)


def make_scene(samples):
    """A new scene set up for small transparent PNG renders with true colors."""
    scene = bpy.data.scenes.new(PREFIX + "sprites")
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.filter_width = 1.2
    scene.render.film_transparent = True
    scene.render.resolution_percentage = 100
    scene.render.use_persistent_data = True
    image = scene.render.image_settings
    if hasattr(image, "media_type"):
        image.media_type = "IMAGE"
    image.file_format = "PNG"
    image.color_mode = "RGBA"
    image.color_depth = "8"
    image.compression = 90
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    return scene


def make_world(scene):
    """Even white sky light, so the sides of each shape read as 3D."""
    world = bpy.data.worlds.new(PREFIX + "world")
    if world.node_tree is None:
        world.use_nodes = True
    nodes = world.node_tree.nodes
    background = next((n for n in nodes if n.type == "BACKGROUND"), None)
    if background is None:
        nodes.clear()
        background = nodes.new("ShaderNodeBackground")
        output = nodes.new("ShaderNodeOutputWorld")
        world.node_tree.links.new(background.outputs["Background"], output.inputs["Surface"])
    background.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    background.inputs["Strength"].default_value = WORLD_STRENGTH
    scene.world = world


def make_material(name, hex_color):
    """A Principled BSDF material from a hex color."""
    material = bpy.data.materials.new(PREFIX + name)
    if material.node_tree is None:
        material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        nodes.clear()
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        output = nodes.new("ShaderNodeOutputMaterial")
        material.node_tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = hex_to_linear(hex_color)
    bsdf.inputs["Roughness"].default_value = ROUGHNESS.get(name, 0.65)
    bsdf.inputs["Metallic"].default_value = METALLIC.get(name, 0.0)
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = SPECULAR.get(name, 0.5)
    return material


def make_collection(scene, name):
    collection = bpy.data.collections.new(PREFIX + name)
    scene.collection.children.link(collection)
    return collection

# ------------------------------------------------------------------ objects


def link(obj, collection, parent=None, location=(0, 0, 0), rotation=(0, 0, 0)):
    """Links an object to a collection and places it in its parent's space."""
    collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def add_empty(name, collection, parent=None, location=(0, 0, 0), rotation=(0, 0, 0)):
    return link(bpy.data.objects.new(PREFIX + name, None), collection, parent, location, rotation)


def finish_mesh(name, bm, is_smooth):
    mesh = bpy.data.meshes.new(PREFIX + name)
    bm.to_mesh(mesh)
    bm.free()
    if is_smooth:
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()
    return mesh


def add_mesh_object(name, mesh, material, collection, parent, location, rotation=(0, 0, 0), scale=(1, 1, 1)):
    mesh.materials.append(material)
    obj = link(bpy.data.objects.new(PREFIX + name, mesh), collection, parent, location, rotation)
    obj.scale = scale
    return obj


def add_ellipsoid(name, collection, parent, center, radii, material):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)
    return add_mesh_object(name, finish_mesh(name, bm, True), material, collection, parent, center, scale=radii)


def add_limb(name, collection, parent, start, end, radius, material):
    """A stretched sphere from `start` to `end`, slightly past both ends so joints overlap."""
    start, end = Vector(start), Vector(end)
    axis = end - start
    obj = add_ellipsoid(name, collection, parent, (start + end) / 2,
                        (axis.length / 2 + radius * 0.6, radius, radius), material)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = axis.to_track_quat("X", "Y" if abs(axis.normalized().z) > 0.9 else "Z")
    return obj


def add_box(name, collection, parent, center, size, material, bevel_ft=0.04):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    obj = add_mesh_object(name, finish_mesh(name, bm, False), material, collection, parent, center)
    if bevel_ft > 0:
        bevel = obj.modifiers.new("Bevel", "BEVEL")
        bevel.width = bevel_ft
        bevel.segments = 2
    return obj


def add_phase_driver(obj, axis_index, root, expression):
    """Drives one rotation axis from the root's "phase" custom property."""
    driver = obj.driver_add("rotation_euler", axis_index).driver
    driver.type = "SCRIPTED"
    variable = driver.variables.new()
    variable.name = "phase"
    variable.type = "SINGLE_PROP"
    variable.targets[0].id = root
    variable.targets[0].data_path = '["phase"]'
    driver.expression = expression

# ------------------------------------------------------------------ characters


def build_stage(scene):
    """Top-down orthographic camera, an overhead sun and an ice plane that only keeps shadows."""
    collection = make_collection(scene, "stage")
    camera_data = bpy.data.cameras.new(PREFIX + "camera")
    camera_data.type = "ORTHO"
    camera_data.clip_start = 0.1
    camera_data.clip_end = 100.0
    camera = link(bpy.data.objects.new(PREFIX + "camera", camera_data), collection, location=(0, 0, 30))
    scene.camera = camera
    sun_data = bpy.data.lights.new(PREFIX + "sun", type="SUN")
    sun_data.energy = SUN_STRENGTH
    sun_data.angle = math.radians(SUN_ANGLE_DEG)
    link(bpy.data.objects.new(PREFIX + "sun", sun_data), collection, location=(0, 0, 40))
    if IS_SHADOW_ON:
        ice = bpy.data.meshes.new(PREFIX + "ice")
        ice.from_pydata([(-60, -12, 0), (60, -12, 0), (60, 12, 0), (-60, 12, 0)], [], [(0, 1, 2, 3)])
        ice.update()
        catcher = link(bpy.data.objects.new(PREFIX + "ice", ice), collection)
        catcher.is_shadow_catcher = True
    return camera


def build_skater(collection, materials, index, offset_x, phase):
    """One skater frame. Returns (root, lower glove) so the hand point can be read back."""
    tag = f"skater{index}_"
    root = add_empty(tag + "root", collection, location=(offset_x, 0, 0))
    root["phase"] = phase
    push_out = math.radians(LEG_PUSH_OUT_DEG)
    push_back = math.radians(LEG_PUSH_BACK_DEG)
    toe_out = math.radians(SKATE_TOE_OUT_DEG)

    for side, phase_shift in ((1, 0.0), (-1, math.pi)):
        label = tag + ("left_" if side > 0 else "right_")
        hip = add_empty(label + "hip", collection, root, (-0.1, side * 0.45, 2.1))
        push = f"max(0, sin(phase + {phase_shift:.6f}))"
        add_phase_driver(hip, 0, root, f"{side * push_out:.6f} * {push}")
        add_phase_driver(hip, 1, root, f"{push_back:.6f} * {push}")
        add_phase_driver(hip, 2, root, f"{side * toe_out:.6f} * {push}")
        add_limb(label + "thigh", collection, hip, (0, 0, 0), (0, 0, -0.95), 0.36, materials["pants"])
        add_limb(label + "shin", collection, hip, (0, 0, -0.9), (0, 0, -1.75), 0.27, materials["jersey"])
        add_ellipsoid(label + "boot", collection, hip, (0.15, 0, -1.88), (0.42, 0.17, 0.14), materials["skate"])
        add_box(label + "blade", collection, hip, (0.1, 0, -2.04), (1.0, 0.05, 0.08), materials["blade"], 0.01)

    upper = add_empty(tag + "upper", collection, root, (0, 0, 2.1), (0, math.radians(FORWARD_LEAN_DEG), 0))
    add_phase_driver(upper, 2, root, f"{-math.radians(SHOULDER_SWAY_DEG):.6f} * sin(phase)")
    add_ellipsoid(tag + "pelvis", collection, upper, (0, 0, 0.05), (0.55, 0.8, 0.45), materials["pants"])
    add_ellipsoid(tag + "torso", collection, upper, (0, 0, 0.95), (0.7, 1.15, 0.8), materials["jersey"])
    add_ellipsoid(tag + "helmet", collection, upper, (0.2, 0, 1.95), (0.55, 0.55, 0.55), materials["helmet"])
    add_ellipsoid(tag + "visor", collection, upper, (0.68, 0, 1.85), (0.12, 0.34, 0.16), materials["visor"])

    lower_glove = None
    arms = (
        ("right_", (0.05, -1.0, 1.4), (0.45, -1.15, 0.85), (0.95, -0.75, 0.5)),
        ("left_", (0.05, 1.0, 1.4), (0.55, 0.8, 0.95), (0.9, 0.1, 0.8)),
    )
    for label, shoulder, elbow, wrist in arms:
        add_limb(tag + label + "upper_arm", collection, upper, shoulder, elbow, 0.25, materials["jersey"])
        add_limb(tag + label + "forearm", collection, upper, elbow, wrist, 0.21, materials["jersey"])
        elbow_at, wrist_at = Vector(elbow), Vector(wrist)
        add_limb(tag + label + "stripe", collection, upper, elbow_at.lerp(wrist_at, 0.2),
                 elbow_at.lerp(wrist_at, 0.45), 0.23, materials["stripe"])
        glove = add_ellipsoid(tag + label + "glove", collection, upper, wrist, (0.24, 0.2, 0.2), materials["glove"])
        if lower_glove is None:
            lower_glove = glove
    return root, lower_glove


def build_goalie(collection, materials, name, pose, offset_x):
    """One goalie pose. Dive and lean point toward Blender -Y (canvas +y)."""
    tag = f"goalie_{name}_"
    root = add_empty(tag + "root", collection, location=(offset_x, 0, 0))
    body = root
    if name == "dive":
        body = add_empty(tag + "body", collection, root, (0, -pose["reach_ft"], DIVE_LIFT_FT),
                         (math.radians(-DIVE_ROLL_DEG), 0, 0))

    for side in (1, -1):
        label = tag + ("left_" if side > 0 else "right_")
        add_limb(label + "thigh", collection, body, (0, side * 0.45, pose["hip_z_ft"]),
                 (0, side * pose["knee_gap_ft"], pose["knee_z_ft"]), 0.32, materials["goalie_jersey"])
        knee = add_empty(label + "knee", collection, body, (0, side * pose["knee_gap_ft"], pose["knee_z_ft"]),
                         (side * math.radians(pose["pad_flare_deg"]), 0, 0))
        add_box(label + "pad", collection, knee, (0.05, 0, -0.925), (0.55, 0.45, 1.85), materials["pad"], 0.08)
        add_box(label + "pad_trim_top", collection, knee, (0.05, 0, -0.65), (0.57, 0.47, 0.12), materials["pad_trim"], 0.02)
        add_box(label + "pad_trim_low", collection, knee, (0.05, 0, -1.3), (0.57, 0.47, 0.12), materials["pad_trim"], 0.02)
        add_box(label + "knee_roll", collection, knee, (0.12, 0, -0.05), (0.42, 0.47, 0.22), materials["pad_trim"], 0.05)

    hip = (0, 0, pose["hip_z_ft"])
    upper_rotation = (math.radians(pose["side_lean_deg"]), math.radians(pose["lean_deg"]), 0)
    upper = add_empty(tag + "upper", collection, body, hip, upper_rotation)
    add_ellipsoid(tag + "torso", collection, upper, (0, 0, 0.75), (0.75, 1.15, 0.85), materials["goalie_jersey"])
    add_ellipsoid(tag + "left_shoulder", collection, upper, (0.05, 0.95, 1.25), (0.45, 0.5, 0.35), materials["goalie_jersey"])
    add_ellipsoid(tag + "right_shoulder", collection, upper, (0.05, -0.95, 1.25), (0.45, 0.5, 0.35), materials["goalie_jersey"])
    add_ellipsoid(tag + "helmet", collection, upper, (0.3, 0, 1.75), (0.55, 0.55, 0.55), materials["goalie_helmet"])
    add_ellipsoid(tag + "cage", collection, upper, (0.78, 0, 1.65), (0.14, 0.4, 0.36), materials["cage"])

    glove_at = (0.6, 1.45, 0.2)
    blocker_at = (1.3, -0.9, 0.0) if name == "poke" else (0.55, -1.4, 0.2)
    add_limb(tag + "glove_arm", collection, upper, (0.05, 0.95, 1.2), glove_at, 0.25, materials["goalie_jersey"])
    add_limb(tag + "blocker_arm", collection, upper, (0.05, -0.95, 1.2), blocker_at, 0.25, materials["goalie_jersey"])
    add_ellipsoid(tag + "glove", collection, upper, glove_at, (0.32, 0.45, 0.45), materials["pad"])
    add_ellipsoid(tag + "glove_cuff", collection, upper, (0.4, 1.2, 0.4), (0.2, 0.25, 0.25), materials["pad_trim"])
    add_box(tag + "blocker", collection, upper, blocker_at, (0.22, 0.55, 0.85), materials["pad"], 0.05)
    add_box(tag + "blocker_stripe", collection, upper, blocker_at, (0.24, 0.14, 0.87), materials["pad_trim"], 0.02)

    grip = body_point(hip, upper_rotation, blocker_at)
    paddle_x = pose["stick_reach_ft"]
    add_limb(tag + "stick_shaft", collection, body, grip, (paddle_x, -0.95, 0.75), 0.07, materials["stick"])
    add_box(tag + "stick_paddle", collection, body, (paddle_x, -0.75, 0.4), (0.12, 0.45, 0.75), materials["stick"], 0.02)
    add_box(tag + "stick_blade", collection, body, (paddle_x + 0.05, 0.05, 0.08), (0.12, 1.25, 0.16), materials["stick"], 0.02)
    return root


def build_puck(collection, materials):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=40,
                          radius1=PUCK_RADIUS_FT, radius2=PUCK_RADIUS_FT, depth=PUCK_THICKNESS_FT)
    puck = add_mesh_object("puck", finish_mesh("puck", bm, False), materials["puck"], collection, None,
                           (0, 0, PUCK_THICKNESS_FT / 2))
    bevel = puck.modifiers.new("Bevel", "BEVEL")
    bevel.width = 0.05
    bevel.segments = 3
    return puck

# ------------------------------------------------------------------ output


def read_hand_points(scene, skaters):
    """The lower glove of each frame in canvas feet (x forward, y to the right)."""
    view_layer = scene.view_layers[0]
    view_layer.update()
    depsgraph = view_layer.depsgraph
    points = []
    for root, glove in skaters:
        at = glove.evaluated_get(depsgraph).matrix_world.translation
        points.append({"x": round(at.x - root.location.x, 3), "y": round(-at.y, 3)})
    return points


def render_strip(scene, camera, strips, name, columns, cell_ft, cell_px, path):
    """Renders one strip: only its collection visible, one cell per frame or pose."""
    for strip_name, collection in strips.items():
        collection.hide_render = strip_name != name
    camera.data.ortho_scale = columns * cell_ft
    scene.render.resolution_x = columns * cell_px
    scene.render.resolution_y = cell_px
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=scene.name)
    clean_alpha(path, cell_px)


def clean_alpha(path, cell_px):
    """Drops the shadow catcher's faint far-off shadow and fades each cell's border to transparent."""
    image = bpy.data.images.load(path)
    width, height = image.size
    pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
    image.pixels.foreach_get(pixels)
    rgba = pixels.reshape(height, width, 4)
    alpha = numpy.clip((rgba[:, :, 3] - FAINT_SHADOW_ALPHA) / (1 - FAINT_SHADOW_ALPHA), 0, 1)
    x = numpy.arange(width) % cell_px
    y = numpy.arange(height) % cell_px
    fade_x = numpy.minimum(numpy.minimum(x, cell_px - 1 - x) / CELL_EDGE_FADE_PX, 1)
    fade_y = numpy.minimum(numpy.minimum(y, cell_px - 1 - y) / CELL_EDGE_FADE_PX, 1)
    rgba[:, :, 3] = alpha * numpy.minimum.outer(fade_y, fade_x)
    image.pixels.foreach_set(rgba.ravel())
    image.save()
    bpy.data.images.remove(image)


def build_manifest(hand_points):
    """The sprites.json contents; src/core/sprites.js validates every field."""
    return {
        "schema_version": 1,
        "sheets": {
            "skater": {
                "file": "skater.png",
                "cell_size_ft": SKATER_CELL_FT,
                "cell_size_px": SKATER_CELL_PX,
                "columns": STRIDE_FRAMES,
                "rows": 1,
                "frame_count": STRIDE_FRAMES,
                "stride_length_ft": STRIDE_LENGTH_FT,
                "hand_ft": hand_points,
            },
            "goalie": {
                "file": "goalie.png",
                "cell_size_ft": GOALIE_CELL_FT,
                "cell_size_px": GOALIE_CELL_PX,
                "columns": len(GOALIE_POSES),
                "rows": 1,
                "side_pose_y": 1,
                "poses": {name: {"index": i, "reach_ft": pose["reach_ft"]}
                          for i, (name, pose) in enumerate(GOALIE_POSES.items())},
            },
            "puck": {
                "file": "puck.png",
                "cell_size_ft": PUCK_CELL_FT,
                "cell_size_px": PUCK_CELL_PX,
                "columns": 1,
                "rows": 1,
            },
        },
    }


def main():
    args = parse_args()
    out_dir = os.path.abspath(args.out) if args.out else default_out_dir()
    os.makedirs(out_dir, exist_ok=True)

    remove_previous_run()
    scene = make_scene(args.samples)
    make_world(scene)
    camera = build_stage(scene)
    materials = {name: make_material(name, hex_color) for name, hex_color in COLORS.items()}
    strips = {name: make_collection(scene, name) for name in ("skater", "goalie", "puck")}

    skaters = [
        build_skater(strips["skater"], materials, i, x, 2 * math.pi * i / STRIDE_FRAMES)
        for i, x in enumerate(cell_offsets(STRIDE_FRAMES, SKATER_CELL_FT))
    ]
    for (name, pose), x in zip(GOALIE_POSES.items(), cell_offsets(len(GOALIE_POSES), GOALIE_CELL_FT)):
        build_goalie(strips["goalie"], materials, name, pose, x)
    build_puck(strips["puck"], materials)

    hand_points = read_hand_points(scene, skaters)
    render_strip(scene, camera, strips, "skater", STRIDE_FRAMES, SKATER_CELL_FT, SKATER_CELL_PX,
                 os.path.join(out_dir, "skater.png"))
    render_strip(scene, camera, strips, "goalie", len(GOALIE_POSES), GOALIE_CELL_FT, GOALIE_CELL_PX,
                 os.path.join(out_dir, "goalie.png"))
    render_strip(scene, camera, strips, "puck", 1, PUCK_CELL_FT, PUCK_CELL_PX,
                 os.path.join(out_dir, "puck.png"))

    with open(os.path.join(out_dir, "sprites.json"), "w", encoding="utf-8") as file:
        json.dump(build_manifest(hand_points), file, indent=2)
        file.write("\n")
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend), copy=True)
    print(f"Breakaway sprites written to {out_dir}")


if __name__ == "__main__":
    main()
