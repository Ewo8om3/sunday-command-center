#!/usr/bin/env bash
# Start the optional ESPN private-league proxy (Mac/Linux). Needs Python 3.
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python)
if [ -z "$PY" ]; then echo "Python 3 is required: https://www.python.org/downloads/"; read -r -p "Press Enter to close"; exit 1; fi
exec "$PY" espn_proxy.py
