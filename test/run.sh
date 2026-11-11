#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
node test/thumbnails.mjs
node test/preload.mjs
