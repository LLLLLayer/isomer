#!/bin/bash
# Same-source check (design/07 rule): convention-location copies must be
# byte-identical to the embed-source files inside the crates.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
check() {
  if ! cmp -s "$1" "$2"; then
    echo "DRIFT: $1 != $2"
    fail=1
  fi
}
check crates/ism-core/schema/plan.v1.json schema/plan.v1.json
# skills/ sync activates in M3 when the skill exists:
if [ -f crates/ism-cli/skill/SKILL.md ]; then
  check crates/ism-cli/skill/SKILL.md skills/ism/SKILL.md
fi
if [ "$fail" -eq 0 ]; then echo "sync ok"; fi
exit "$fail"
