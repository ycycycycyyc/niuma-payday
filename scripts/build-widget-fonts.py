"""Convert the official ChillRoundF v3.200 TTFs to locally bundled web fonts.

Run with a local fonttools + brotli installation and the extracted official release
as --source-dir. Only the names and web container change; all glyphs are retained.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".local-data" / "font-tools"))
from fontTools.ttLib import TTFont


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    args = parser.parse_args()
    output = ROOT / "src" / "assets" / "fonts"
    notice_dir = ROOT / "public" / "licenses"
    output.mkdir(parents=True, exist_ok=True)
    notice_dir.mkdir(parents=True, exist_ok=True)
    license_text = (args.source_dir / "LICENSE.txt").read_text(encoding="utf-8-sig")
    (notice_dir / "OFL-Niuma-Rounded.txt").write_text(license_text, encoding="utf-8")
    manifest = {
        "family": "Niuma Rounded",
        "upstream": "ChillRoundF v3.200 / ChillType",
        "source": "https://github.com/Warren2060/ChillRound/releases/tag/v3.200",
        "archive": "https://github.com/Warren2060/ChillRound/releases/download/v3.200/ChillRoundF_v3.200.zip",
        "license": "SIL Open Font License 1.1",
        "notice": "/licenses/OFL-Niuma-Rounded.txt",
        "modifications": "Renamed family and PostScript names; converted TTF to WOFF2. No glyph subsetting or outline changes.",
        "fonts": [],
    }
    required_text = "今日已赚距离下班工作时段演示数据浮窗设置返回大小底色不透明度恢复默认已自动保存选择完成选色圆心柔和外圈鲜明明暗请输入位颜色值0123456789.,:–%#¥HK$••"
    for style, weight in [("Regular", 400), ("Bold", 700)]:
        source = args.source_dir / f"ChillRoundF{style}.ttf"
        font = TTFont(source)
        cmap = font.getBestCmap()
        missing = sorted(set(required_text) - {chr(code) for code in cmap})
        if missing:
            raise RuntimeError(f"Missing widget glyphs in {style}: {missing}")
        names = font["name"]
        replacements = {
            1: "Niuma Rounded", 2: style, 3: f"NiumaRounded-{style}-3.200",
            4: f"Niuma Rounded {style}", 6: f"NiumaRounded-{style}",
            13: license_text, 14: "https://openfontlicense.org/",
            16: "Niuma Rounded", 17: style, 18: f"Niuma Rounded {style}",
            21: "Niuma Rounded", 22: style,
        }
        for record in list(names.names):
            if record.nameID in replacements:
                names.removeNames(record.nameID, record.platformID, record.platEncID, record.langID)
        for name_id, text in replacements.items():
            names.setName(text, name_id, 3, 1, 0x409)
        destination = output / f"niuma-rounded-{style.lower()}.woff2"
        font.flavor = "woff2"
        font.save(destination)
        restored = TTFont(destination)
        if restored.getBestCmap() != cmap:
            raise RuntimeError(f"Glyph map changed during {style} conversion")
        manifest["fonts"].append({
            "file": destination.name, "weight": weight, "bytes": destination.stat().st_size,
            "sourceSha256": sha256(source), "sha256": sha256(destination),
            "glyphs": len(restored.getGlyphOrder()), "codepoints": len(cmap),
            "digitAdvancesEm": [round(font["hmtx"][cmap[ord(digit)]][0] / font["head"].unitsPerEm, 3) for digit in "0123456789"],
        })
    (output / "niuma-rounded-source.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
