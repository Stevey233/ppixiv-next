#!/bin/sh
# Build the userscript and copy it to dist/ppixiv-next.user.js.
# Run from anywhere; the upstream build expects the repo root as the working directory.
set -e
cd "$(dirname "$0")/.."
python3 -m vview.build.build_ppixiv
cp output/ppixiv-main.user.js dist/ppixiv-next.user.js
grep -m1 '@version' dist/ppixiv-next.user.js
