#!/usr/bin/env bash
# One-click launcher for macOS / Linux. First run installs dependencies (~2 GB incl. models).
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
  source .venv/bin/activate
  pip install --upgrade pip
  if [ "$(uname)" = "Darwin" ]; then pip install torch; else pip install torch --index-url https://download.pytorch.org/whl/cpu; fi
  pip install transformers
else
  source .venv/bin/activate
fi
python app.py "$@"
