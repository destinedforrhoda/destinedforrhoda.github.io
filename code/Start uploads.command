#!/bin/sh
set -eu
PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$PROJECT_DIR"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
if ! .venv/bin/python -c 'import flask, waitress, PIL, pillow_heif, imageio_ffmpeg' >/dev/null 2>&1; then
  .venv/bin/python -m pip install -r code/requirements.txt
fi
exec .venv/bin/python code/server.py
