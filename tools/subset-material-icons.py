#!/usr/bin/env python3
"""Regenerate or verify the bundled Material Icons ligatures."""

import argparse
import re
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "web/resources/material-icons.woff"

ICON_LITERAL = re.compile(
    r"""["']mat:([a-z0-9_]+)["']"""
    r"""|(?:\bcreateIcon\(\s*|\bicon:\s*)["']([a-z0-9_]+)["']"""
)

# Raw ligature names written directly into icon nodes. Dynamic choices whose
# names appear in icon options or mat: strings are picked up by ICON_LITERAL.
WRITTEN_ICONS = {
    "check_box", "check_box_outline_blank",  # widgets/simple.js
    "keyboard_double_arrow_left", "keyboard_double_arrow_right",  # screen-search/search-ui-desktop.js
    "unfold_less", "unfold_more",  # screen-search/search-ui-desktop.js
    "download_done",  # screen-illust/desktop-image-info.js
    "panorama", "portrait",  # viewer/images/editing-pan.js
    "star", "star_border",  # sites/gelbooru/tag-library-dialog.js
}


def used_icons():
    names = set(WRITTEN_ICONS)
    for path in (ROOT / "web").rglob("*.js"):
        for prefixed, bare in ICON_LITERAL.findall(path.read_text(encoding="utf-8")):
            names.add(prefixed or bare)
    return names


def ligature_tables(font):
    """Yield each rlig table and the names of its ligatures."""
    characters = {glyph: chr(codepoint) for codepoint, glyph in font.getBestCmap().items()}
    gsub = font["GSUB"].table
    for feature in gsub.FeatureList.FeatureRecord:
        if feature.FeatureTag != "rlig":
            continue
        for index in feature.Feature.LookupListIndex:
            for table in gsub.LookupList.Lookup[index].SubTable:
                names = {}
                for first, ligatures in table.ligatures.items():
                    for ligature in ligatures:
                        name = "".join(characters[glyph] for glyph in [first, *ligature.Component])
                        names[name] = (first, ligature)
                yield table, names


def generate(source, names):
    with TTFont(source, recalcTimestamp=False) as font:
        available = set()
        for table, ligatures in ligature_tables(font):
            available.update(ligatures)
            # Filtering the lookup first prevents the subsetter from retaining
            # every other ligature that uses the same input characters.
            table.ligatures = {}
            for name, (first, ligature) in ligatures.items():
                if name in names:
                    table.ligatures.setdefault(first, []).append(ligature)

        if missing := names - available:
            raise SystemExit(f"Source font is missing: {', '.join(sorted(missing))}")

        options = subset.Options()
        options.name_IDs += [10, 13, 14]
        font["name"].setName("Subset by ppixiv for its interface.", 10, 3, 1, 0x409)
        font["name"].setName("Apache License, Version 2.0", 13, 3, 1, 0x409)
        font["name"].setName("https://www.apache.org/licenses/LICENSE-2.0", 14, 3, 1, 0x409)
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(text="".join(sorted(names)))
        subsetter.subset(font)
        font.flavor = "woff"
        font.flavorData = None
        font.save(OUTPUT)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--source", type=Path, help="Path to the original font (WOFF2 or decoded TTF)")
    action.add_argument("--check", action="store_true", help="Check the committed subset against current usage")
    args = parser.parse_args()

    names = used_icons()
    if args.source:
        generate(args.source, names)

    with TTFont(OUTPUT) as font:
        bundled = {name for _, ligatures in ligature_tables(font) for name in ligatures}
    if missing := names - bundled:
        raise SystemExit(f"Subset is missing: {', '.join(sorted(missing))}")
    if unused := bundled - names:
        raise SystemExit(f"Subset has unused ligatures: {', '.join(sorted(unused))}")

    print(f"{len(names)} Material Icons ligatures ({OUTPUT.stat().st_size} bytes)")
    print(", ".join(sorted(names)))


if __name__ == "__main__":
    main()
