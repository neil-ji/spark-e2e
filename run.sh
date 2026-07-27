#!/usr/bin/env bash
set -euo pipefail

# spark-e2e npm/npx entry point
# Delegates to the Python spark-e2e CLI after ensuring it's installed.

PYTHON="${SPARK_E2E_PYTHON:-python3}"
PIP_INSTALLER="${SPARK_E2E_PIP_INSTALLER:-pip}"

# Check if spark-e2e Python package is installed
check_installed() {
    "$PYTHON" -c "import spark_e2e" 2>/dev/null
}

# Install via pip if not already installed
ensure_installed() {
    if check_installed; then
        return 0
    fi

    echo "[spark-e2e] Python package not found. Installing via pip..." >&2

    # Try uv first (faster), then pipx, then plain pip
    if command -v uv &>/dev/null && uv pip --help &>/dev/null 2>&1; then
        echo "[spark-e2e] Using uv to install..." >&2
        uv pip install spark-e2e
    elif command -v pipx &>/dev/null; then
        echo "[spark-e2e] Using pipx to install..." >&2
        pipx install spark-e2e
    else
        echo "[spark-e2e] Using pip to install..." >&2
        "$PIP_INSTALLER" install spark-e2e
    fi

    if ! check_installed; then
        echo "[spark-e2e] ERROR: Installation failed. Try: pip install spark-e2e" >&2
        exit 1
    fi
}

ensure_installed
exec spark-e2e "$@"
