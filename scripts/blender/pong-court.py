# -*- coding: utf-8 -*-
"""Editable Blender court and calibrated, pre-baked browser layers.

Run with Blender 5.2:
  blender --background --factory-startup --python pong-court.py -- --camera-only
  blender --background --factory-startup --python pong-court.py -- --samples 96
All materials and models are procedural; no external assets are required.
"""
import argparse
import json
import math
import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

PROJECT = Path(r"D:\blender建模\niuma-ping-pong")
LIBRARY = Path(r"D:\blender建模\素材库\niuma-ping-pong")
ASSETS = Path(r"D:\Codex\牛马鼓励器\src\assets\pong-court")
WIDTH, HEIGHT = 900, 550
TABLE_WIDTH, TABLE_LENGTH, TABLE_HEIGHT = 1.525, 2.74, .76
NET_HEIGHT = .1525
Z_SCALE = NET_HEIGHT / .155
GAME_TO_WORLD = Matrix(((TABLE_WIDTH / 2, 0, 0, 0), (0, TABLE_LENGTH / 2, 0, 0), (0, 0, Z_SCALE, TABLE_HEIGHT), (0, 0, 0, 1)))


def args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--camera-only', action='store_true')
    parser.add_argument('--samples', type=int, default=96)
    parser.add_argument('--preview', action='store_true')
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def reset_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if not collection.objects:
            bpy.data.collections.remove(collection)
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = WIDTH * 2, HEIGHT * 2
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    return scene


def make_camera(scene):
    # Solve the four target corners, with a centered principal point.
    near_half, far_half, span = 380., 255., 335.
    ratio = far_half / near_half
    k = TABLE_LENGTH / (1 / ratio - 1)
    fscale = near_half / (TABLE_WIDTH / 2)
    hcoef = span * (k + TABLE_LENGTH) / (fscale * TABLE_LENGTH)
    angle = math.asin(((HEIGHT / 2 - 460) / fscale + hcoef) / k)
    height = hcoef * math.cos(angle)
    distance = k - hcoef * math.sin(angle)
    focal_pixels = fscale * k * math.cos(angle)
    data = bpy.data.cameras.new('Court.Camera.Calibrated')
    camera = bpy.data.objects.new('Court.Camera.Calibrated', data)
    scene.collection.objects.link(camera)
    camera.location = (0, -distance, TABLE_HEIGHT + height)
    camera.rotation_euler = Vector((0, math.cos(angle), -math.sin(angle))).to_track_quat('-Z', 'Y').to_euler()
    data.type, data.sensor_fit, data.sensor_width = 'PERSP', 'HORIZONTAL', 36
    # A 10% wider view and 20px lower principal point reserve real headroom for lobs.
    data.lens = focal_pixels * 36 / WIDTH * .90
    data.shift_y = 20 / WIDTH
    data.clip_start, data.clip_end = .03, 100
    data.dof.use_dof = False
    scene.camera = camera
    bpy.context.view_layer.update()
    return camera


def write_camera(scene, camera):
    projection = camera.calc_matrix_camera(bpy.context.evaluated_depsgraph_get(), x=WIDTH, y=HEIGHT, scale_x=1, scale_y=1)
    clip = projection @ camera.matrix_world.inverted() @ GAME_TO_WORLD
    matrix = [[float((clip[0][j] + clip[3][j]) * WIDTH / 2) for j in range(4)],
              [float((clip[3][j] - clip[1][j]) * HEIGHT / 2) for j in range(4)],
              [float(clip[3][j]) for j in range(4)]]
    def pixel(point):
        world = GAME_TO_WORLD @ Vector((*point, 1))
        uv = world_to_camera_view(scene, camera, Vector(world[:3]))
        return {'x': uv.x * WIDTH, 'y': (1 - uv.y) * HEIGHT}
    corners = {'nearLeft': pixel((-1, 0, 0)), 'nearRight': pixel((1, 0, 0)),
               'farLeft': pixel((-1, 2, 0)), 'farRight': pixel((1, 2, 0))}
    metadata = {
        'version': 1, 'width': WIDTH, 'height': HEIGHT, 'matrix': matrix,
        'background': {'file': 'court.webp', 'width': WIDTH * 2, 'height': HEIGHT * 2},
        'net': {'file': 'net.png', 'width': WIDTH * 2, 'height': HEIGHT * 2, 'premultiplied': False},
        'coordinates': {'x': '[-1,1] across table width', 'y': '[0,2] from player to computer',
                        'z': '0 at table surface; .155 is the .1525m net height'},
        'metersPerGameUnit': {'x': TABLE_WIDTH / 2, 'y': TABLE_LENGTH / 2, 'z': Z_SCALE},
        'table': {'widthMeters': TABLE_WIDTH, 'lengthMeters': TABLE_LENGTH, 'heightMeters': TABLE_HEIGHT, 'corners': corners},
        'netTop': {'left': pixel((-1.154, 1, .155)), 'center': pixel((0, 1, .155)), 'right': pixel((1.154, 1, .155))},
        'zSamples': [{'game': [0, y, z], 'pixel': pixel((0, y, z))} for y in (0, .5, 1, 1.5, 2) for z in (0, .1, .2, .35)],
        'camera': {'lensMillimeters': camera.data.lens, 'locationMeters': list(camera.location),
                   'rotationEulerRadians': list(camera.rotation_euler), 'sensorWidthMillimeters': camera.data.sensor_width},
        'source': {'application': bpy.app.version_string, 'script': 'scripts/blender/pong-court.py',
                   'project': str(PROJECT / 'court.blend'), 'materials': 'procedural; no external textures'},
    }
    for target in (ASSETS / 'camera.json', PROJECT / 'court-camera.json', LIBRARY / 'court-camera.json'):
        target.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    print('COURT_CAMERA=' + json.dumps(corners), flush=True)


def collection(name):
    value = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(value)
    return value


def put(obj, target):
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    target.objects.link(obj)
    return obj


def color(hex_color):
    values = [int(hex_color[index:index + 2], 16) / 255 for index in (0, 2, 4)]
    return tuple(value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in values) + (1,)


def material(name, hex_color, roughness=.4, metal=0, micro=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    surface = nodes.get('Principled BSDF')
    surface.inputs['Base Color'].default_value = color(hex_color)
    surface.inputs['Roughness'].default_value = roughness
    surface.inputs['Metallic'].default_value = metal
    if micro:
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 250
        noise.inputs['Detail'].default_value = 3
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .12
        bump.inputs['Distance'].default_value = micro
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], surface.inputs['Normal'])
    return mat


def box(name, location, dimensions, mat, target, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        obj.data.materials.append(mat)
    if bevel:
        edge = obj.modifiers.new('Machined rounded edges', 'BEVEL')
        edge.width, edge.segments = bevel, 3
        obj.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL')
    return put(obj, target)


def rod(name, start, end, radius, mat, target, vertices=12):
    direction = Vector(end) - Vector(start)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length, location=(Vector(start) + Vector(end)) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    obj.data.materials.append(mat)
    for face in obj.data.polygons:
        face.use_smooth = True
    return put(obj, target)


def wooden_floor(target):
    mat = material('Floor / satin maple parquet', 'BFA484', .38)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    surface = nodes.get('Principled BSDF')
    coordinates = nodes.new('ShaderNodeTexCoord')
    bricks = nodes.new('ShaderNodeTexBrick')
    links.new(coordinates.outputs['Object'], bricks.inputs['Vector'])
    bricks.inputs['Scale'].default_value = 1
    bricks.inputs['Mortar Size'].default_value = .0022
    bricks.inputs['Mortar Smooth'].default_value = .001
    bricks.inputs['Brick Width'].default_value = .14
    bricks.inputs['Row Height'].default_value = 1.10
    bricks.inputs['Color1'].default_value = color('D3B993')
    bricks.inputs['Color2'].default_value = color('BBA27F')
    bricks.inputs['Mortar'].default_value = color('9E896B')
    stretch = nodes.new('ShaderNodeVectorMath')
    stretch.operation = 'MULTIPLY'
    stretch.inputs[1].default_value = (180, 2.4, 1)
    links.new(coordinates.outputs['Object'], stretch.inputs[0])
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1
    noise.inputs['Detail'].default_value = 2.5
    noise.inputs['Roughness'].default_value = .65
    links.new(stretch.outputs['Vector'], noise.inputs['Vector'])
    grain = nodes.new('ShaderNodeValToRGB')
    grain.color_ramp.elements[0].position = .15
    grain.color_ramp.elements[0].color = (.35, .29, .22, 1)
    grain.color_ramp.elements[1].position = .85
    grain.color_ramp.elements[1].color = (.9, .84, .74, 1)
    links.new(noise.outputs['Fac'], grain.inputs['Fac'])
    mix = nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = .28
    links.new(bricks.outputs['Color'], mix.inputs[1])
    links.new(grain.outputs['Color'], mix.inputs[2])
    links.new(mix.outputs['Color'], surface.inputs['Base Color'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .12
    bump.inputs['Distance'].default_value = .0012
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], surface.inputs['Normal'])
    # Apply scale to keep parquet dimensions in physical meters.
    return box('Hall.Floor.Maple', (0, 2, -.045), (10, 13, .09), mat, target)


def area(name, location, aim, power, size, hex_color, target, size_y=None):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.color = power, color(hex_color)[:3]
    data.shape, data.size = 'RECTANGLE', size
    data.size_y = size if size_y is None else size_y
    obj = bpy.data.objects.new(name, data)
    target.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(aim) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    return obj


def build_court(scene):
    static = collection('Court.Static')
    net = collection('Court.Net')
    lighting = collection('Court.Lighting')
    table = material('Table / relaxed club teal microtexture', '1D5E58', .52, micro=.00012)
    table.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = .18
    apron = material('Frame / dark teal powder coat', '294D49', .32, .15, .00008)
    steel = material('Hardware / cool brushed steel', '8798A7', .25, .78, .00003)
    dark_steel = material('Structure / cold charcoal steel', '35434F', .34, .68, .00005)
    rubber = material('Casters / rubber', '161C22', .64)
    white = material('Markings / warm white enamel', 'E5E9E6', .39)
    woven = material('Net / dark woven polyester', '26323A', .56, micro=.00012)
    tape = material('Net / ivory woven top band', 'DADBD4', .48, micro=.00010)
    wall = material('Hall / warm pale mineral plaster', 'D5CBB9', .78, micro=.0004)
    timber = material('Hall / oak acoustic trim', 'A98B63', .46, micro=.0001)
    seat_wood = material('Bench / softly grained light oak', 'C8AC85', .43, micro=.00010)
    wood_nodes, wood_links = seat_wood.node_tree.nodes, seat_wood.node_tree.links
    wood_coord = wood_nodes.new('ShaderNodeTexCoord')
    wood_stretch = wood_nodes.new('ShaderNodeVectorMath')
    wood_stretch.operation = 'MULTIPLY'
    wood_stretch.inputs[1].default_value = (75, 2.2, 4)
    wood_links.new(wood_coord.outputs['Generated'], wood_stretch.inputs[0])
    wood_noise = wood_nodes.new('ShaderNodeTexNoise')
    wood_noise.inputs['Scale'].default_value = 1
    wood_noise.inputs['Detail'].default_value = 2.5
    wood_links.new(wood_stretch.outputs['Vector'], wood_noise.inputs['Vector'])
    wood_ramp = wood_nodes.new('ShaderNodeValToRGB')
    wood_ramp.color_ramp.elements[0].color = color('BDA078')
    wood_ramp.color_ramp.elements[1].color = color('D1B68F')
    wood_links.new(wood_noise.outputs['Fac'], wood_ramp.inputs['Fac'])
    wood_links.new(wood_ramp.outputs['Color'], wood_nodes.get('Principled BSDF').inputs['Base Color'])
    barrier = material('Barriers / quiet sage canvas', '58766B', .73, micro=.0003)
    floor_lines = material('Floor / quiet court lines', 'D8CBB3', .5)
    wooden_floor(static)
    # Full editable architecture remains in the blend, including off-camera light sources.
    box('Hall.BackWall', (0, 5.8, 2.25), (10, .18, 4.5), wall, static, .02)
    for side in (-1, 1):
        box(f'Hall.SideWall.{side}', (side * 4.9, 1.5, 2.25), (.16, 8.5, 4.5), wall, static, .01)
        box(f'Hall.Baseboard.{side}', (side * 4.80, 1.5, .08), (.05, 8.5, .16), timber, static, .005)
    for x in (-4, -2, 0, 2, 4):
        box(f'Hall.AcousticSlat.{x}', (x, 5.685, 2.0), (.12, .055, 3.7), timber, static, .007)
    for y in (-2.5, 1.4, 5.3):
        box(f'Hall.CeilingBeam.{y}', (0, y, 4.45), (9.7, .12, .18), dark_steel, static, .01)
    for x in (-1.7, 1.7):
        box(f'Court.SideLine.{x}', (x, 1.37, .002), (.026, 5.6, .002), floor_lines, static)
    for y in (-1.43, 4.17):
        box(f'Court.EndLine.{y}', (0, y, .002), (3.42, .026, .002), floor_lines, static)
    # Low competition barriers provide a quiet dark field behind the white ball.
    for index, x in enumerate((-1.48, -.5, .5, 1.48)):
        box(f'Barrier.Back.Panel.{index}', (x, 4.30, .37), (.98, .018, .70), barrier, static, .008)
        rod(f'Barrier.Back.Top.{index}', (x - .49, 4.30, .735), (x + .49, 4.30, .735), .009, dark_steel, static)
        for end in (-1, 1):
            rod(f'Barrier.Back.Leg.{index}.{end}', (x + end * .46, 4.30, .02), (x + end * .46, 4.30, .74), .009, dark_steel, static)
            rod(f'Barrier.Back.Foot.{index}.{end}', (x + end * .46, 4.12, .025), (x + end * .46, 4.48, .025), .012, dark_steel, static)
    for side in (-1, 1):
        center_x = side * 1.48
        for slat in (-1, 0, 1):
            box(f'Hall.Bench.SeatSlat.{side}.{slat}', (center_x + slat * .106, 3.50, .444), (.090, 1.25, .027), seat_wood, static, .005)
        for y in (3.03, 3.97):
            box(f'Hall.Bench.UnderSeatRail.{side}.{y}', (center_x, y, .412), (.30, .035, .025), steel, static, .003)
            for end in (-1, 1):
                leg_x = center_x + end * .115
                box(f'Hall.Bench.TubeLeg.{side}.{y}.{end}', (leg_x, y, .216), (.026, .026, .385), dark_steel, static, .003)
                box(f'Hall.Bench.FootCap.{side}.{y}.{end}', (leg_x, y, .025), (.036, .036, .018), rubber, static, .003)
                rod(f'Hall.Bench.SeatBolt.{side}.{y}.{end}', (leg_x, y, .456), (leg_x, y, .458), .0035, steel, static, 6)
                rod(f'Hall.Bench.KneeBrace.{side}.{y}.{end}', (leg_x, y, .31), (center_x, y, .405), .008, dark_steel, static, 8)
        for end in (-1, 1):
            box(f'Hall.Bench.LowerStretcher.{side}.{end}', (center_x + end * .115, 3.50, .145), (.020, .98, .023), dark_steel, static, .003)
    # Main table: physical 1.525m x 2.74m, with a distinct edge and full support frame.
    box('Table.Top.45mm', (0, 1.37, TABLE_HEIGHT - .0225), (TABLE_WIDTH, TABLE_LENGTH, .045), table, static, .008)
    for side in (-1, 1):
        box(f'Table.LongApron.{side}', (side * .724, 1.37, .672), (.055, 2.65, .13), apron, static, .007)
        box(f'Table.EdgeStripe.{side}', (side * .7445, 1.37, .7606), (.018, 2.70, .0012), white, static, .001)
    for y in (.018, 2.722):
        box(f'Table.EndStripe.{y}', (0, y, .7606), (1.49, .018, .0012), white, static, .001)
        box(f'Table.EndApron.{y}', (0, y + (.015 if y > 1 else -.015), .674), (1.45, .055, .125), apron, static, .006)
    # A folded steel apron has a rolled lip, shallow panel seams and actual bolts.
    for z in (.621, .726):
        box(f'Table.FrontApron.FoldedLip.{z}', (0, -.027, z), (1.435, .009, .008), dark_steel, static, .002)
    for x in (-.365, .365):
        box(f'Table.FrontApron.PanelJoint.{x}', (x, -.0253, .674), (.0025, .0015, .087), dark_steel, static, .0006)
    for x in (-.655, -.39, .39, .655):
        for z in (.647, .701):
            rod(f'Table.FrontApron.Washer.{x}.{z}', (x, -.0260, z), (x, -.0272, z), .0068, steel, static, 16)
            rod(f'Table.FrontApron.HexBolt.{x}.{z}', (x, -.0272, z), (x, -.0300, z), .0046, steel, static, 6)
    box('Table.CenterMark.3mm', (0, 1.37, .7607), (.003, 2.7, .0011), white, static)
    for side in (-1, 1):
        for index, y in enumerate((.38, 2.36)):
            x = side * .55
            box(f'Table.Leg.{side}.{index}', (x, y, .352), (.045, .045, .55), dark_steel, static, .003)
            box(f'Table.LegCollar.{side}.{index}', (x, y, .57), (.058, .058, .065), steel, static, .003)
            box(f'Table.CasterFork.{side}.{index}', (x, y, .085), (.06, .045, .06), steel, static, .004)
            rod(f'Table.CasterRubber.{side}.{index}', (x - .017, y, .048), (x + .017, y, .048), .043, rubber, static, 32)
            rod(f'Table.CasterAxle.{side}.{index}', (x - .021, y, .048), (x + .021, y, .048), .012, steel, static, 16)
            rod(f'Table.DiagonalBrace.{side}.{index}', (x, y, .54), (x, 1.37, .23), .013, steel, static)
        box(f'Table.LongStretcher.{side}', (side * .55, 1.37, .23), (.033, 2.02, .035), dark_steel, static, .003)
    for y in (.38, 2.36):
        box(f'Table.CrossStretcher.{y}', (0, y, .18), (1.14, .034, .035), dark_steel, static, .003)
        box(f'Table.CrossSupport.{y}', (0, y, .65), (1.20, .04, .045), steel, static, .003)
    # Independently rendered, physically modelled net, including clamps and tension fittings.
    for side in (-1, 1):
        x = side * .88
        rod(f'Net.Post.{side}', (x, 1.37, .737), (x, 1.37, .938), .008, dark_steel, net, 24)
        rod(f'Net.PostCap.{side}', (x, 1.37, .935), (x, 1.37, .944), .0105, steel, net, 24)
        box(f'Net.ClampTop.{side}', (side * .79, 1.37, .773), (.12, .065, .018), dark_steel, net, .004)
        box(f'Net.ClampUnder.{side}', (side * .79, 1.37, .712), (.10, .06, .017), dark_steel, net, .003)
        box(f'Net.ClampOutside.{side}', (side * .84, 1.37, .742), (.018, .055, .074), dark_steel, net, .003)
        rod(f'Net.ClampScrew.{side}', (side * .80, 1.37, .675), (side * .80, 1.37, .72), .004, steel, net, 12)
        rod(f'Net.ClampKnob.{side}', (side * .80, 1.354, .68), (side * .80, 1.386, .68), .008, rubber, net, 12)
        rod(f'Net.TensionCord.{side}', (side * .868, 1.37, .918), (side * .88, 1.37, .936), .0009, tape, net, 8)
    top = TABLE_HEIGHT + NET_HEIGHT
    box('Net.TopWhiteBand', (0, 1.37, top - .006), (1.76, .0024, .012), tape, net, .0006)
    rod('Net.TopTensionCable', (-.88, 1.37, top), (.88, 1.37, top), .0007, tape, net, 8)
    for index in range(142):
        x = -.88 + index * 1.76 / 141
        rod(f'Net.Mesh.Vertical.{index:03}', (x, 1.37, TABLE_HEIGHT + .006), (x, 1.37, top - .012), .00042, woven, net, 6)
    for index in range(11):
        z = TABLE_HEIGHT + .006 + index * (NET_HEIGHT - .018) / 10
        rod(f'Net.Mesh.Horizontal.{index:02}', (-.88, 1.37, z), (.88, 1.37, z), .00042, woven, net, 6)
    # Broad architectural lights give material detail without bright spots behind the ball.
    area('Light.Ceiling.Softbox', (-.9, .9, 4.4), (0, 1.3, .6), 550, 3.8, 'FFE9D2', lighting, 2.7)
    area('Light.Camera.Fill', (-2.5, -2.4, 3.5), (0, 1.2, .7), 160, 3.5, 'F4E4D2', lighting, 2.0)
    area('Light.Window.WarmRim', (3.2, 3.5, 3.8), (0, 1.3, .7), 350, 2.6, 'FFE2B9', lighting, 3.2)
    area('Light.Back.WallWash', (-2.0, 4.8, 2.9), (0, 3.7, .3), 130, 2.2, 'F5E8D9', lighting, 1.5)
    world = bpy.data.worlds.new('Court.World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = color('B9C3CC')
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .12
    scene.world = world


def render_layers(scene, options):
    scene.render.engine = 'CYCLES'
    preferences = bpy.context.preferences.addons['cycles'].preferences
    try:
        preferences.compute_device_type = 'OPTIX'
        preferences.get_devices()
        for device in preferences.devices:
            device.use = device.type == 'OPTIX'
        scene.cycles.device = 'GPU'
    except Exception:
        scene.cycles.device = 'CPU'
    scene.cycles.samples = 24 if options.preview else max(32, options.samples)
    scene.cycles.use_denoising = True
    scene.cycles.adaptive_threshold = .02
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.compression = 25
    scene.render.filepath = str(PROJECT / 'court-reference.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(PROJECT / 'court.blend'))
    # Camera invisibility keeps net shadows on the table in the background plate.
    for obj in bpy.data.collections['Court.Net'].objects:
        obj.visible_camera = False
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.quality = 94
    scene.render.filepath = str(ASSETS / 'court.webp')
    scene.render.film_transparent = False
    bpy.ops.render.render(write_still=True)
    shutil.copy2(ASSETS / 'court.webp', PROJECT / 'court.webp')
    shutil.copy2(ASSETS / 'court.webp', LIBRARY / 'court.webp')
    for obj in bpy.data.collections['Court.Net'].objects:
        obj.visible_camera = True
    # Holdout geometry hides clamps or strings behind the actual table, with clear alpha elsewhere.
    static_layer = bpy.context.view_layer.layer_collection.children['Court.Static']
    static_layer.holdout = True
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = str(ASSETS / 'net.png')
    bpy.ops.render.render(write_still=True)
    shutil.copy2(ASSETS / 'net.png', PROJECT / 'court-net.png')
    shutil.copy2(ASSETS / 'net.png', LIBRARY / 'court-net.png')
    static_layer.holdout = False
    scene.render.film_transparent = False
    scene.render.filepath = str(PROJECT / 'court-reference.png')
    bpy.ops.render.render(write_still=True)
    # Save a clean, fully visible, editable beauty scene rather than a special-purpose pass state.
    bpy.ops.wm.save_as_mainfile(filepath=str(PROJECT / 'court.blend'))
    manifest = {'background': str(ASSETS / 'court.webp'), 'net': str(ASSETS / 'net.png'),
                'camera': str(ASSETS / 'camera.json'), 'blend': str(PROJECT / 'court.blend'),
                'objectCount': len(scene.objects), 'renderSize': [scene.render.resolution_x, scene.render.resolution_y],
                'samples': scene.cycles.samples, 'device': scene.cycles.device, 'application': bpy.app.version_string}
    (PROJECT / 'court-render-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print('COURT_COMPLETE=' + json.dumps(manifest, ensure_ascii=False), flush=True)


def main():
    options = args()
    for directory in (PROJECT, LIBRARY, ASSETS):
        directory.mkdir(parents=True, exist_ok=True)
    if Path(__file__).resolve() != (PROJECT / 'court-model.py').resolve():
        shutil.copy2(__file__, PROJECT / 'court-model.py')
    scene = reset_scene()
    camera = make_camera(scene)
    write_camera(scene, camera)
    if options.camera_only:
        return
    build_court(scene)
    render_layers(scene, options)


if __name__ == '__main__':
    main()
