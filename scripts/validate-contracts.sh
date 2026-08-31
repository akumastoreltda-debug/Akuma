#!/usr/bin/env bash

set -u

run_contract_stage() {
  local stage="$1"
  local description="$2"
  local reproduction="$3"
  shift 3

  printf '\n[contracts] %s\n' "$stage"
  "$@"
  local status=$?

  if [ "$status" -ne 0 ]; then
    printf '[contracts] FAILED: %s\n' "$description"
    printf '[contracts] Failed command: %s\n' "$*"
    printf '[contracts] Reproduce locally with: %s\n' "$reproduction"
    return "$status"
  fi
}

run_contract_stage \
  "Stage 1/2: generated output verification" \
  "generated output verification" \
  "pnpm run contracts:check" \
  pnpm run contracts:check || exit $?

run_contract_stage \
  "Stage 2/2: regression suite" \
  "regression suite" \
  "pnpm run contracts:test" \
  pnpm run contracts:test