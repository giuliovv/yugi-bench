#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$ROOT/vendor/goat-format-simulator/engine/browser/out/ocgcore.bundle.js" ]]; then
  echo "Missing pinned core. Run: git submodule update --init --recursive" >&2
  exit 1
fi
cd "$ROOT"
PYTHONPATH=src python3 -m pytest -q
cd vendor/goat-format-simulator/engine/browser
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
node check-reglas.mjs > "$TMP/rules.log"
node check-cartas.mjs > "$TMP/cards.log"
node check-sync.mjs > "$TMP/sync.log"
grep -F '4/4 escenarios se comportan como en 2005' "$TMP/rules.log"
grep -F '17/17 comprobaciones de carta pasan' "$TMP/cards.log"
grep -F 'desajustes: 0' "$TMP/sync.log"
tail -4 "$TMP/sync.log"
