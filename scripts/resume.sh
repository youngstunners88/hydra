#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f data/HALT ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] data/HALT does not exist — nothing to resume"
  exit 0
fi

rm data/HALT
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] RESUMED — data/HALT removed"
