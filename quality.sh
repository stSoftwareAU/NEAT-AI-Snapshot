#!/usr/bin/env bash
# Quality gate for NEAT-AI-Snapshot.
#
# Runs the repository's own checks. Every stage fails loud: `set -euo pipefail`
# aborts on the first non-zero exit, so a broken stage can never be reported as
# a pass.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Workflow install-script guard"
node tools/check_install_scripts.mjs

echo "==> Unit tests"
node --test "tests/**/*.test.mjs"

echo "==> All quality checks passed"
