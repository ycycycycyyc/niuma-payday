"""Editable professional table-tennis equipment and transparent game sprites.

Run with a separate Blender background process; all output paths are explicit.
No external textures, add-ons, scene files or user preferences are loaded.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
from datetime import datetime
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


def arguments():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", default=r"D:\blender建模\niuma-ping-pong\equipment")
    parser.add_argument("--assets", default=str(Path(__file__).resolve().parents[2] / "src/assets/pong-equipment"))
    parser.add_argument("--archive", default=r"D:\blender建模\素材库\niuma-ping-pong\equipment")
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--runtime-size", type=int, default=512)
    parser.add_argument("--samples", type=int, default=64)
    return parser.parse_args(values)


ARGS = arguments()
OUTPUT = Path(ARGS.output_root).resolve()
ASSETS = Path(ARGS.assets).resolve()
ARCHIVE = Path(ARGS.archive).resolve()
for directory in (OUTPUT, ASSETS, ARCHIVE, OUTPUT / "renders", OUTPUT / "backups"):
    directory.mkdir(parents=True, exist_ok=True)


def rgba(hex_color):
    value = hex_color.lstrip("#")
    rgb = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v < .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb) + (1,)


def material(name, color, roughness=.5, metallic=0):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = rgba(color)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return result


def wood(name, light, dark):
    result = material(name, light, .38)
    tree = result.node_tree
    shader = tree.nodes.get("Principled BSDF")
    coords = tree.nodes.new("ShaderNodeTexCoord")
    stretch = tree.nodes.new("ShaderNodeVectorMath")
    stretch.operation = "MULTIPLY"
    stretch.inputs[1].default_value = (56, 2.0, 5)
    tree.links.new(coords.outputs["Generated"], stretch.inputs[0])
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.3
    noise.inputs["Detail"].default_value = 3
    noise.inputs["Roughness"].default_value = .7
    tree.links.new(stretch.outputs["Vector"], noise.inputs["Vector"])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = .25
    ramp.color_ramp.elements[0].color = rgba(dark)
    ramp.color_ramp.elements[1].position = .78
    ramp.color_ramp.elements[1].color = rgba(light)
    tree.links.new(noise.outputs["Fac"], ramp.inputs[0])
    tree.links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = .12
    bump.inputs["Distance"].default_value = .000055
    tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return result


def rubber(name, color):
    result = material(name, color, .73)
    tree = result.node_tree
    shader = tree.nodes.get("Principled BSDF")
    shader.inputs["Specular IOR Level"].default_value = .28
    coords = tree.nodes.new("ShaderNodeTexCoord")
    grain = tree.nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 390
    grain.inputs["Detail"].default_value = 2
    tree.links.new(coords.outputs["Generated"], grain.inputs["Vector"])
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = .16
    bump.inputs["Distance"].default_value = .000026
    tree.links.new(grain.outputs["Fac"], bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return result


MAPLE = wood("Veneer • warm limba face", "E7C998", "B98B58")
AYOUS = wood("Veneer • pale ayous", "F4E0B7", "CBAD7D")
WALNUT = wood("Veneer • fine walnut", "AF7953", "785034")
HANDLE = wood("Handle • lengthwise ash grain", "B89362", "6E4D31")
INLAY = wood("Handle • dark lengthwise inlay", "725544", "44382D")
RED = rubber("Top sheet • professional red rubber", "AC2239")
BLACK = rubber("Top sheet • graphite black rubber", "25272B")
RED_FOAM = material("Red rubber • visible sponge edge", "B84D58", .92)
BLACK_FOAM = material("Black rubber • visible sponge edge", "A98963", .92)
INK = material("Rubber • small ivory print", "C8C3BA", .82)
TAIL = material("Handle • graphite tail badge", "30343C", .42)
TAIL_EDGE = material("Handle • pale badge surround", "DBCCB4", .42)
BALL = material("Ball • matte ivory polymer", "F8F8F2", .34)
BALL_SEAM = material("Ball • subtle formed seam", "E1E1D9", .45)
BALL_INK = material("Ball • minute graphite print", "778086", .75)


def smooth_bezier(segments, steps=18):
    result = []
    for p0, p1, p2, p3 in segments:
        for index in range(steps):
            t = index / steps
            result.append(tuple((1 - t) ** 3 * p0[axis] + 3 * (1 - t) ** 2 * t * p1[axis]
                                + 3 * (1 - t) * t ** 2 * p2[axis] + t ** 3 * p3[axis] for axis in (0, 1)))
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(result, result[1:] + result[:1]))
    return result if area > 0 else list(reversed(result))


RIGHT_HEAD = [
    ((0, .084), (.045, .086), (.076, .059), (.078, .021)),
    ((.078, .021), (.079, -.014), (.060, -.050), (.031, -.066)),
]
RUBBER_RIGHT = [
    ((0, .0825), (.044, .0845), (.0745, .058), (.0765, .021)),
    ((.0765, .021), (.0775, -.0135), (.059, -.0485), (.0295, -.0645)),
    ((.0295, -.0645), (.017, -.074), (.010, -.075), (0, -.075)),
]


def mirror_segments(segments):
    return [tuple((-point[0], point[1]) for point in reversed(segment)) for segment in reversed(segments)]


CORE_RIGHT = RIGHT_HEAD + [
    ((.031, -.066), (.020, -.073), (.014, -.078), (.0135, -.092)),
    ((.0135, -.092), (.013, -.120), (.013, -.153), (.013, -.174)),
    ((.013, -.174), (.013, -.178), (.007, -.178), (0, -.178)),
]
CORE_OUTLINE = smooth_bezier(CORE_RIGHT + mirror_segments(CORE_RIGHT))
RUBBER_OUTLINE = smooth_bezier(RUBBER_RIGHT + mirror_segments(RUBBER_RIGHT))


def link_object(name, mesh, collection, parent=None):
    result = bpy.data.objects.new(name, mesh)
    collection.objects.link(result)
    if parent:
        result.parent = parent
    return result


def extruded(name, outline, thickness, center_z, mat, collection, parent, bevel=.00022):
    count = len(outline)
    vertices = [(x, y, center_z - thickness / 2) for x, y in outline]
    vertices += [(x, y, center_z + thickness / 2) for x, y in outline]
    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    faces += [(index, (index + 1) % count, (index + 1) % count + count, index + count) for index in range(count)]
    mesh = bpy.data.meshes.new(name + " • editable contour")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    mesh.update()
    result = link_object(name, mesh, collection, parent)
    for polygon in mesh.polygons:
        polygon.use_smooth = polygon.index > 1
    if bevel:
        modifier = result.modifiers.new("Fine manufactured edge radius", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        modifier.limit_method = "ANGLE"
        modifier.harden_normals = True
        normal = result.modifiers.new("Weighted cap normals", "WEIGHTED_NORMAL")
        normal.keep_sharp = True
    return result


HANDLE_RINGS = [(-.077, .0136, .0038), (-.089, .0132, .0065), (-.112, .0125, .0074),
                (-.140, .0135, .0076), (-.165, .0155, .007), (-.179, .0158, .0048)]


def handle_top(y):
    for first, second in zip(HANDLE_RINGS, HANDLE_RINGS[1:]):
        if second[0] <= y <= first[0]:
            t = (y - first[0]) / (second[0] - first[0])
            height = first[2] + (second[2] - first[2]) * t
            return height * 2 + .0022
    return HANDLE_RINGS[-1][2] * 2 + .0022


def handle_grip(name, side, collection, parent):
    rings = HANDLE_RINGS
    vertices, faces = [], []
    count = 48
    for y, width, height in rings:
        for index in range(count):
            angle = index * math.tau / count
            a, b = math.cos(angle), math.sin(angle)
            x = math.copysign(abs(a) ** .48, a) * width
            # The inner grip surface always overlaps the wooden blade. Changing
            # the end radius must not open an air gap above/below the core.
            z = math.copysign(abs(b) ** .65, b) * height + side * (height + .0022)
            vertices.append((x, y, z))
    for ring in range(len(rings) - 1):
        for index in range(count):
            nxt = (index + 1) % count
            faces.append((ring * count + index, ring * count + nxt, (ring + 1) * count + nxt, (ring + 1) * count + index))
    faces += [tuple(reversed(range(count))), tuple(range((len(rings) - 1) * count, len(rings) * count))]
    mesh = bpy.data.meshes.new(name + " • flared waist loft")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(HANDLE)
    mesh.update()
    result = link_object(name, mesh, collection, parent)
    for face in mesh.polygons:
        face.use_smooth = True
    bevel = result.modifiers.new("Comfortable handle end radius", "BEVEL")
    bevel.width = .0007
    bevel.segments = 3
    return result


def handle_inlay(name, collection, parent):
    rows = [-.098, -.112, -.140, -.160, -.170]
    vertices = [(x, y, handle_top(y) + .00009) for y in rows for x in (-.0027, .0027)]
    faces = [(index * 2, index * 2 + 1, index * 2 + 3, index * 2 + 2) for index in range(len(rows) - 1)]
    mesh = bpy.data.meshes.new(name + " • conforms to grip curvature")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(INLAY)
    mesh.update()
    result = link_object(name, mesh, collection, parent)
    solid = result.modifiers.new("Inset veneer thickness", "SOLIDIFY")
    solid.thickness = .00018
    return result


def cube(name, location, dimensions, mat, collection, parent, bevel=.0006):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    result = bpy.context.object
    result.name = name
    for source in list(result.users_collection):
        source.objects.unlink(result)
    collection.objects.link(result)
    result.parent = parent
    result.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    result.data.materials.append(mat)
    modifier = result.modifiers.new("Rounded inlay corners", "BEVEL")
    modifier.width = bevel
    modifier.segments = 4
    return result


def text(name, body, location, size, mat, collection, parent):
    curve = bpy.data.curves.new(name + " • editable print", "FONT")
    curve.body = body
    curve.size = size
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.extrude = .000002
    result = link_object(name, curve, collection, parent)
    result.location = location
    curve.materials.append(mat)
    return result


def racket(name, upper, lower, upper_foam, lower_foam):
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    parent = link_object(name + " • assembly", None, collection)
    for index, mat in enumerate([MAPLE, AYOUS, WALNUT, AYOUS, WALNUT, AYOUS, MAPLE]):
        extruded(name + f" • wood veneer {index + 1:02d}", CORE_OUTLINE, .00085,
                 -.003 + .00085 * (index + .5), mat, collection, parent, .00009)
    for sign, face, foam in [(1, upper, upper_foam), (-1, lower, lower_foam)]:
        extruded(name + (" • upper sponge" if sign > 0 else " • lower sponge"), RUBBER_OUTLINE,
                 .00145, sign * .00372, foam, collection, parent, .00012)
        rubber_face = extruded(name + (" • upper rubber" if sign > 0 else " • lower rubber"), RUBBER_OUTLINE,
                                .00122, sign * .00505, face, collection, parent, .00022)
        if sign > 0:
            visible_rubber = rubber_face
    handle_grip(name + " • upper flared handle", 1, collection, parent)
    handle_grip(name + " • lower flared handle", -1, collection, parent)
    handle_inlay(name + " • dark central handle inlay", collection, parent)
    cube(name + " • solid continuous butt cap", (0, -.1784, 0), (.0305, .0016, .024), HANDLE, collection, parent, .0007)
    tail_z = handle_top(-.164)
    cube(name + " • tail badge surround", (0, -.164, tail_z + .00020), (.017, .0115, .00055), TAIL_EDGE, collection, parent, .0013)
    cube(name + " • tail badge", (0, -.164, tail_z + .00055), (.0145, .009, .00045), TAIL, collection, parent, .001)
    text(name + " • tail monogram", "N", (0, -.164, tail_z + .00082), .0062, INK, collection, parent)
    text(name + " • subtle rubber wordmark", "NIUMA", (0, -.052, .00571), .0041, INK, collection, parent)
    text(name + " • face rating", "01", (.027, -.047, .00571), .0023, INK, collection, parent)
    return collection, parent, visible_rubber


def ball():
    collection = bpy.data.collections.new("Ball • 40mm polymer shell")
    bpy.context.scene.collection.children.link(collection)
    parent = link_object("Ball • assembly", None, collection)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=.020)
    sphere = bpy.context.object
    sphere.name = "Ball • editable smooth shell"
    for source in list(sphere.users_collection):
        source.objects.unlink(sphere)
    collection.objects.link(sphere)
    sphere.parent = parent
    sphere.data.materials.append(BALL)
    for polygon in sphere.data.polygons:
        polygon.use_smooth = True
    curve = bpy.data.curves.new("Ball • single fine formed seam", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = .000022
    curve.bevel_resolution = 3
    spline = curve.splines.new("POLY")
    spline.points.add(255)
    for index, point in enumerate(spline.points):
        angle = index * math.tau / 256
        point.co = (.005 * math.sin(angle), .019375 * math.sin(angle), .02001 * math.cos(angle), 1)
    spline.use_cyclic_u = True
    seam = link_object("Ball • almost flush seam", curve, collection, parent)
    curve.materials.append(BALL_SEAM)
    direction = Vector((.12, -.62, .78)).normalized()
    imprint = text("Ball • tiny NIUMA imprint", "NIUMA", direction * .02002, .0022, BALL_INK, collection, parent)
    imprint.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return collection, parent, sphere


def point_camera(camera, target):
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def area_light(name, position, energy, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = rgba(color)[:3]
    result = link_object(name, data, bpy.context.scene.collection)
    result.location = position
    point_camera(result, (0, -.035, 0))


def projected_bounds(scene, camera, obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    points = [world_to_camera_view(scene, camera, evaluated.matrix_world @ vertex.co) for vertex in mesh.vertices]
    evaluated.to_mesh_clear()
    xs = [point.x * scene.render.resolution_x for point in points]
    ys = [(1 - point.y) * scene.render.resolution_y for point in points]
    return {"centerX": (min(xs) + max(xs)) / 2, "centerY": (min(ys) + max(ys)) / 2,
            "radiusX": (max(xs) - min(xs)) / 2, "radiusY": (max(ys) - min(ys)) / 2}


def visible(collection, enabled):
    for obj in collection.objects:
        obj.hide_render = not enabled


def render_sprite(name, collection, assembly, contact_object, camera, ortho_scale, runtime_size):
    scene = bpy.context.scene
    for group, _, _ in EQUIPMENT.values():
        visible(group, group == collection)
    assembly.location = (0, 0, 0)
    scene.render.resolution_x = ARGS.size
    scene.render.resolution_y = ARGS.size
    camera.data.ortho_scale = ortho_scale
    camera.location = (0, -.54, .46)
    point_camera(camera, (0, -.036 if name != "ball" else 0, 0))
    if name == "ball":
        camera.location = (0, -.54, .46)
        point_camera(camera, (0, 0, 0))
    bpy.context.view_layer.update()
    bounds = projected_bounds(scene, camera, contact_object)
    original = OUTPUT / "renders" / f"{name}-1024.png"
    scene.render.filepath = str(original)
    bpy.ops.render.render(write_still=True)
    shutil.copy2(original, ARCHIVE / original.name)
    image = bpy.data.images.load(str(original), check_existing=False)
    image.scale(runtime_size, runtime_size)
    image.filepath_raw = str(ASSETS / f"{name}.png")
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)
    factor = runtime_size / ARGS.size
    return {"file": f"{name}.png", "width": runtime_size, "height": runtime_size,
            **{key: round(value * factor, 4) for key, value in bounds.items()},
            "contact": "rubber face" if name != "ball" else "sphere silhouette",
            "handleDirection": "near" if name == "player" else "far" if name == "computer" else None}


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = ARGS.samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.render.threads_mode = "FIXED"
scene.render.threads = 6
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
scene.render.resolution_percentage = 100
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (.45, .49, .55, 1)
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = .17
scene.view_settings.view_transform = "AgX"
try:
    scene.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    pass
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
camera_data = bpy.data.cameras.new("Equipment • calibrated orthographic camera")
camera_data.type = "ORTHO"
camera = link_object("Equipment • calibrated orthographic camera", camera_data, scene.collection)
scene.camera = camera
area_light("Equipment • broad warm key", (-.24, -.30, .48), 2.8, .38, "FFF6EB")
area_light("Equipment • warm soft fill", (.28, -.05, .27), 1.0, .32, "FFF0D9")
area_light("Equipment • upper rim", (.10, .28, .35), 1.4, .28, "FFFFFF")

EQUIPMENT = {
    "player": racket("Player • red upper / black lower", RED, BLACK, RED_FOAM, BLACK_FOAM),
    "computer": racket("Computer • black upper / red lower", BLACK, RED, BLACK_FOAM, RED_FOAM),
    "ball": ball(),
}
EQUIPMENT["computer"][1].rotation_euler.z = math.pi
sprites = {}
for name, (collection, assembly, contact) in EQUIPMENT.items():
    sprites[name] = render_sprite(name, collection, assembly, contact, camera,
                                  .34 if name != "ball" else .052, ARGS.runtime_size if name != "ball" else 256)

metadata = {"version": 1, "provenance": "Editable Blender geometry; procedural materials; no external image textures.",
            "alignment": "Map centerX/centerY and radiusX/radiusY to the engine projection. Handle is outside contact ellipse.",
            **sprites}
for destination in (ASSETS / "sprites.json", OUTPUT / "sprites.json", ARCHIVE / "sprites.json"):
    destination.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Save a clean, editable overview rather than three overlapping export objects.
for name, (collection, assembly, _) in EQUIPMENT.items():
    visible(collection, True)
    assembly.location = (-.125 if name == "player" else .125 if name == "computer" else 0,
                         -.015 if name != "ball" else .11, .025 if name == "ball" else 0)
camera.location = (0, -.65, .72)
camera.data.ortho_scale = .51
point_camera(camera, (0, -.035, 0))
scene.render.resolution_x = 1400
scene.render.resolution_y = 1120
scene.render.filepath = str(OUTPUT / "equipment-review.png")
bpy.ops.render.render(write_still=True)
shutil.copy2(OUTPUT / "equipment-review.png", ARCHIVE / "equipment-review.png")
model = OUTPUT / "equipment.blend"
if model.exists():
    shutil.copy2(model, OUTPUT / "backups" / f"equipment-{datetime.now():%Y%m%d-%H%M%S}.blend")
bpy.ops.wm.save_as_mainfile(filepath=str(model))
shutil.copy2(Path(__file__).resolve(), OUTPUT / "pong-equipment.py")
inventory = {"blender": bpy.app.version_string, "objects": len(bpy.data.objects),
             "editableMeshes": sum(1 for mesh in bpy.data.meshes if mesh.users), "materials": [mat.name for mat in bpy.data.materials],
             "blend": str(model), "sprites": metadata,
             "sha256": {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in ASSETS.iterdir() if file.is_file()}}
(OUTPUT / "equipment-inventory.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("EQUIPMENT_COMPLETE " + json.dumps({"blend": str(model), "assets": str(ASSETS), "sprites": sprites}, ensure_ascii=False))
