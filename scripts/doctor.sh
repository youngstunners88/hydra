#!/usr/bin/env bash
set -euo pipefail

# Hydra doctor — environment and connectivity health checks.
# Exit nonzero if any REQUIRED check fails.

PASS=0
FAIL=0
SKIP=0
FAILED_CHECKS=()

pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); FAILED_CHECKS+=("$1"); }
skip() { echo "  [SKIP] $1"; SKIP=$((SKIP + 1)); }

section() { echo ""; echo "== $1 =="; }

check_chain_id() {
  local name="$1"
  local rpc_url="$2"
  local expected_chain_id="$3"
  local response
  response=$(curl -s -m 8 -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    "$rpc_url" 2>/dev/null || true)

  if [[ -z "$response" ]]; then
    fail "$name: RPC unreachable ($rpc_url)"
    return
  fi

  local actual
  actual=$(echo "$response" | grep -o '"result":"0x[0-9a-fA-F]*"' | cut -d'"' -f4 || true)
  if [[ -z "$actual" ]]; then
    fail "$name: no eth_chainId result from $rpc_url"
    return
  fi

  local actual_dec
  actual_dec=$((16#${actual#0x}))
  if [[ "$actual_dec" == "$expected_chain_id" ]]; then
    pass "$name chainId=$expected_chain_id"
  else
    fail "$name chainId mismatch: expected $expected_chain_id, got $actual_dec"
  fi
}

section "Venue RPC chain IDs"
check_chain_id "base"                 "https://mainnet.base.org"                    8453
check_chain_id "robinhood_chain"      "https://rpc.mainnet.chain.robinhood.com"     4663
check_chain_id "pulsechain"           "https://rpc.pulsechain.com"                  369

section "GMGN"
if [[ -n "${GMGN_API_KEY:-}" ]]; then
  pass "GMGN_API_KEY present"
else
  fail "GMGN_API_KEY missing (hunt plane intel will be degraded)"
fi

section "Agent-Reach"
if command -v agent-reach >/dev/null 2>&1; then
  if agent-reach doctor --json >/dev/null 2>&1; then
    pass "agent-reach doctor"
  else
    fail "agent-reach doctor returned nonzero"
  fi
else
  skip "agent-reach binary not installed (optional)"
fi

section "Browser hunter sidecar"
BROWSER_HUNTER_URL="${BROWSER_HUNTER_URL:-http://localhost:8090}"
if curl -s -m 5 "${BROWSER_HUNTER_URL}/health" >/dev/null 2>&1; then
  pass "browser-hunter health endpoint"
else
  skip "browser-hunter health endpoint not reachable (optional unless browser hunting)"
fi

section "Halt file"
if [[ -f data/HALT ]]; then
  echo ""
  echo "  ⚠️  ⚠️  ⚠️  data/HALT EXISTS — trading is halted ⚠️  ⚠️  ⚠️"
  echo ""
  pass "halt file detected"
else
  pass "no halt file"
fi

section "Token registries"
for f in config/tokens/*.json; do
  if jq empty "$f" >/dev/null 2>&1; then
    pass "$f valid JSON"
  else
    fail "$f invalid JSON"
  fi
done

echo ""
echo "──────────────────────────────"
echo "Doctor complete: $PASS passed, $FAIL failed, $SKIP skipped"
if [[ $FAIL -gt 0 ]]; then
  echo "Failed checks:"
  for c in "${FAILED_CHECKS[@]}"; do
    echo "  - $c"
  done
  exit 1
fi
exit 0
