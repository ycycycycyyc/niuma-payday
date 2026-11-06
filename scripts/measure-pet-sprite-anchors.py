"""Measure sprite alpha bounds without modifying the source artwork.

Requires Pillow. Run with python -X utf8 scripts/measure-pet-sprite-anchors.py.
"""
from pathlib import Path
import json
from statistics import median
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPECS = {
    'walk': ('widget-dog-walk.webp', 4, 1),
    'actions': ('widget-dog-actions.webp', 7, 1),
    'companion': ('widget-dog-companion.png', 4, 4),
    'sleep': ('widget-dog-sleep.png', 6, 3),
    'play': ('widget-dog-play.png', 4, 3),
    'transitions': ('widget-dog-transitions.png', 8, 6),
}

def measure(filename, columns, rows):
    with Image.open(ROOT / 'src/assets' / filename) as image:
        alpha = image.convert('RGBA').getchannel('A').point(lambda value: 255 if value >= 128 else 0)
        frames = []
        for row in range(rows):
            for column in range(columns):
                left, top = round(column * image.width / columns), round(row * image.height / rows)
                right, bottom = round((column + 1) * image.width / columns), round((row + 1) * image.height / rows)
                bounds = alpha.crop((left, top, right, bottom)).getbbox()
                if bounds is None:
                    raise ValueError(f'Empty sprite: {filename} row={row} column={column}')
                frames.append(dict(zip(('left', 'top', 'right', 'bottom'), (
                    round(bounds[0] / (right - left), 7), round(bounds[1] / (bottom - top), 7),
                    round(bounds[2] / (right - left), 7), round(bounds[3] / (bottom - top), 7),
                ))))
    return {'columns': columns, 'rows': rows, 'frames': frames}

def width(frame):
    return frame['right'] - frame['left']

def main():
    sheets = {name: measure(*spec) for name, spec in SPECS.items()}
    reference = sheets['actions']['frames'][0]
    # Calibrate only non-looping bridges. A smooth endpoint correction matches
    # separately authored sheets without resizing a sleeping breathing cycle.
    targets = [
        ('companion', 0, 5), ('sleep', 0, 7), ('sleep', 6, 7),
        ('sleep', 12, 7), ('play', 0, 7), ('actions', 0, 7),
    ]
    for row, (target_sheet, target_frame, last_frame) in enumerate(targets):
        frames = sheets['transitions']['frames'][row * 8:(row + 1) * 8]
        start_scale = width(reference) / width(frames[0])
        end_scale = width(sheets[target_sheet]['frames'][target_frame]) / width(frames[last_frame])
        for index, frame in enumerate(frames):
            progress = min(index / last_frame, 1)
            eased = progress * progress * (3 - 2 * progress)
            frame['scale'] = round(start_scale + (end_scale - start_scale) * eased, 7)
    output = ROOT / 'shared/pet-sprite-anchors.json'
    output.write_text(json.dumps({'version': 1, 'ground': .98, 'sheets': sheets}, indent=2) + '\n', encoding='utf-8')
    print(f'Measured {sum(len(sheet["frames"]) for sheet in sheets.values())} sprite cells: {output}')
    for name, sheet in sheets.items():
        bottoms = [frame['bottom'] for frame in sheet['frames']]
        print(f'{name}: visible bottom {min(bottoms):.3f}..{max(bottoms):.3f}, median={median(bottoms):.3f}')

if __name__ == '__main__':
    main()
