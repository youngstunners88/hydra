#!/usr/bin/env bash
set -euo pipefail

mkdir -p data
touch data/HALT
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] HALTED — data/HALT created"
