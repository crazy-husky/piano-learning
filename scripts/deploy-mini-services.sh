#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINI_SERVICES_ROOT="${MINI_SERVICES_ROOT:-$(cd "$SCRIPT_DIR/../../mini-services" && pwd)}"
exec "$MINI_SERVICES_ROOT/scripts/deploy/deploy.sh" "$@"
