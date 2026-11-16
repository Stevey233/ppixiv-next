#!/usr/bin/env python3
"""Build the Gelbooru tag pack in data/ from two public datasets.

    UV_CACHE_DIR=~/.cache/uv uv run -q --no-project --with pyarrow python -I \\
        tools/build-gelbooru-tags.py <gelbooru_tags.parquet> <zh csv directory> [output directory]

<gelbooru_tags.parquet> is DraconicDragon/Gelbooru-Tags-Full_2026-06-11 (Apache-2.0), and the
directory holds {artist,character,copyright,general,meta}.csv from ame-la/danbooru-tags-data-zh
(MIT).  The output directory defaults to data/ next to tools/.

The pack is one gzipped TSV, one tag per line, most used first:

    #ppixiv-gelbooru-tags 1<TAB>tag<TAB>category<TAB>count<TAB>zh<TAB>aliases<TAB>notes
    1girl<TAB>0<TAB>8314081<TAB>一个女孩<TAB>1girls|girl|女孩<TAB>画面中有且仅有...

category is Gelbooru's (0 general, 1 artist, 3 copyright, 4 character, 5 meta).  zh is empty when
there is no translation, aliases are |-separated.  The file is named after a hash of its contents,
so a URL never changes what it serves.  Running the script twice gives identical files.
"""

import csv
import datetime
import gzip
import hashlib
import html
import json
import os
import sys

import pyarrow.parquet as pq

MIN_COUNT = 50
DROP_CATEGORIES = {2, 6}  # invalid, deprecated
ZH_FILES = ("artist", "character", "copyright", "general", "meta")
HEADER = "#ppixiv-gelbooru-tags 1\ttag\tcategory\tcount\tzh\taliases\tnotes"
FORMAT = 1

SOURCES = [
    {
        "name": "Gelbooru-Tags-Full_2026-06-11",
        "url": "https://huggingface.co/datasets/DraconicDragon/Gelbooru-Tags-Full_2026-06-11",
        "date": "2026-06-11",
        "license": "Apache-2.0",
        "provides": "tag, category, count",
    },
    {
        "name": "danbooru-tags-data-zh",
        "url": "https://huggingface.co/datasets/ame-la/danbooru-tags-data-zh",
        "date": "2026-11-16 (downloaded)",
        "license": "MIT, Copyright (c) 2026 amenorira",
        "provides": "zh, aliases, notes",
    },
]


def read_gelbooru(path, stats):
    """Return {name: (count, category)}, one entry per usable tag name."""
    table = pq.read_table(path, columns=["tag_id", "tag_name", "post_count", "category_id"]).to_pydict()
    best = {}
    for tag_id, name, count, category in zip(table["tag_id"], table["tag_name"], table["post_count"], table["category_id"]):
        if not name:
            stats["empty names"] += 1
            continue

        # A few names still carry HTML escapes ("miqo&#039;te", "1girl&nbsp;").  Each is a stray
        # copy of the real tag with a handful of posts, so the decoded name merges into it below.
        decoded = html.unescape(name)
        if decoded != name:
            stats["names with HTML entities"] += 1
            name = decoded

        # Gelbooru separates tags by spaces, so a name with whitespace in it (a tab, a newline,
        # U+3000, a decoded &nbsp;) can't be searched for.
        if any(c.isspace() for c in name):
            stats["names with whitespace (dropped)"] += 1
            continue

        # Some names appear more than once: keep the most used row, then the oldest.
        key = (count, -tag_id)
        if name in best:
            stats["duplicate names (merged)"] += 1
            if best[name][0] >= key:
                continue
        best[name] = (key, count, category)
    return {name: (count, category) for name, (_key, count, category) in best.items()}


def read_zh(directory, stats):
    """Return {tag: (zh, aliases, notes)}."""
    result = {}
    for file in ZH_FILES:
        with open(os.path.join(directory, file + ".csv"), encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                tag = row["tag"]
                if tag in result:
                    stats["duplicate translated tags (first kept)"] += 1
                    continue
                zh = row["zh"].strip()
                if zh == tag:
                    zh = ""
                aliases = []
                for alias in html.unescape(row["aliases"]).split("|"):
                    alias = alias.strip()
                    if alias and alias != tag and alias not in aliases:
                        aliases.append(alias)
                result[tag] = (zh, "|".join(aliases), row["notes"].strip())
    return result


def build_rows(gel, zh, stats):
    rows = []
    for name, (count, category) in gel.items():
        translation = zh.get(name)
        if count < MIN_COUNT and translation is None:
            continue
        if category in DROP_CATEGORIES:
            stats["translated tags dropped as invalid or deprecated"] += translation is not None
            continue
        row = [name, str(category), str(count)] + list(translation or ("", "", ""))
        for field in row:
            if any(c in field for c in "\t\n\r"):
                raise SystemExit("field with a tab or line break in %r" % name)
        rows.append(row)
    stats["translated tags missing on Gelbooru"] = sum(1 for tag in zh if tag not in gel)
    rows.sort(key=lambda row: (-int(row[2]), row[0]))
    return rows


def main():
    if len(sys.argv) not in (3, 4):
        raise SystemExit(__doc__)
    parquet, zh_dir = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) == 4 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    os.makedirs(out, exist_ok=True)

    stats = {
        "empty names": 0,
        "names with HTML entities": 0,
        "names with whitespace (dropped)": 0,
        "duplicate names (merged)": 0,
        "duplicate translated tags (first kept)": 0,
        "translated tags dropped as invalid or deprecated": 0,
    }
    gel = read_gelbooru(parquet, stats)
    zh = read_zh(zh_dir, stats)
    rows = build_rows(gel, zh, stats)

    text = HEADER + "\n" + "".join("\t".join(row) + "\n" for row in rows)
    raw = text.encode("utf-8")
    version = hashlib.sha256(raw).hexdigest()[:12]
    packed = gzip.compress(raw, compresslevel=9, mtime=0)
    file_name = "gelbooru-tags.%s.tsv.gz" % version

    # Remove packs of earlier versions, then write this one.
    for name in os.listdir(out):
        if name.startswith("gelbooru-tags.") and name.endswith(".tsv.gz") and name != file_name:
            os.remove(os.path.join(out, name))
    with open(os.path.join(out, file_name), "wb") as f:
        f.write(packed)

    # The build date only moves when the contents do, so a rebuild changes nothing.
    manifest_path = os.path.join(out, "gelbooru-tags.json")
    built = datetime.date.today().isoformat()
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as f:
            old = json.load(f)
        if old.get("version") == version:
            built = old["built"]

    manifest = {
        "format": FORMAT,
        "version": version,
        "built": built,
        "rows": len(rows),
        "columns": HEADER.split("\t")[1:],
        "categories": {"0": "general", "1": "artist", "3": "copyright", "4": "character", "5": "metadata"},
        "rules": "Gelbooru tags with at least %d posts, plus every translated tag Gelbooru has; "
            "no invalid or deprecated tags; Gelbooru's category wins" % MIN_COUNT,
        "files": [{
            "name": file_name,
            "bytes": len(packed),
            "uncompressed_bytes": len(raw),
            "sha256": hashlib.sha256(packed).hexdigest(),
        }],
        "sources": SOURCES,
    }
    with open(manifest_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    translated = sum(1 for row in rows if row[3])
    print("%d rows, %d with a Chinese name, %d with notes" % (len(rows), translated, sum(1 for row in rows if row[5])))
    print("%s: %d bytes (%d uncompressed)" % (file_name, len(packed), len(raw)))
    for key, value in stats.items():
        print("%s: %d" % (key, value))


if __name__ == "__main__":
    main()
