#!/usr/bin/env bash
# Prepares a macOS Host for the xa11y driver. Safe to run again: it changes only what is missing.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.23.3}"
XA11Y_HOME="${XA11Y_HOME:-$HOME/Library/Application Support/appium-xa11y}"
LABEL=appium-xa11y
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"

usage() {
  cat <<'EOF'
Usage: setup.sh [options]        install Appium 3 and the driver, and run Appium as a LaunchAgent
       host.sh run               run Appium in this shell

Options:
  --driver <path|npm spec>   the driver to install (default: appium-xa11y-driver from npm)
  --address <ip>             where Appium listens (default: 127.0.0.1; Appium has no authentication)
  --port <port>              default: 4723
  --no-service               install only; start Appium with: host.sh run
EOF
}

log() { printf '\033[1m==>\033[0m %s\n' "$*" >&2; }
die() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

node_ok() {
  command -v node >/dev/null && node -e '
    const [a, b] = process.versions.node.split(".").map(Number);
    process.exit(a > 22 || (a === 22 && b >= 12) || (a === 20 && b >= 19) ? 0 : 1);'
}

install_node() {
  export PATH="$XA11Y_HOME/node/bin:$PATH"
  node_ok && return
  local arch
  case "$(uname -m)" in
    arm64) arch=arm64 ;;
    x86_64) arch=x64 ;;
    *) die "no Node.js build for $(uname -m)" ;;
  esac
  log "Installing Node.js $NODE_VERSION in $XA11Y_HOME/node"
  rm -rf "$XA11Y_HOME/node" && mkdir -p "$XA11Y_HOME/node"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$arch.tar.gz" \
    | tar -xz --strip-components=1 -C "$XA11Y_HOME/node"
}

appium() { APPIUM_HOME="$XA11Y_HOME/appium-home" "$XA11Y_HOME/appium/node_modules/.bin/appium" "$@"; }

install_appium() {
  if ! appium --version 2>/dev/null | grep -q '^3\.'; then
    log "Installing Appium 3 in $XA11Y_HOME/appium"
    npm install --prefix "$XA11Y_HOME/appium" --no-audit --no-fund --loglevel=error appium@3 >/dev/null
  fi
}

install_driver() {
  local source=npm spec="$DRIVER"
  if [ -d "$DRIVER" ]; then
    source=local
    spec="$(cd "$DRIVER" && pwd)"
    log "Building the driver in $spec"
    (cd "$spec" && { [ -d node_modules ] || npm ci --no-audit --no-fund --loglevel=error; } && npm run build >/dev/null)
  fi
  if appium driver list --installed --json 2>/dev/null | grep -q '"xa11y"'; then
    [ "$source" = npm ] && appium driver update xa11y >/dev/null 2>&1 || true
    return
  fi
  log "Installing the driver from $spec"
  local out
  out=$(appium driver install --source="$source" "$spec" 2>&1) || die "the driver did not install: $out"
}

write_env() {
  printf 'ADDRESS=%q\nPORT=%q\nPATH=%q\n' "$ADDRESS" "$PORT" "$XA11Y_HOME/node/bin:$PATH" >"$XA11Y_HOME/host.env"
  install -m 0755 "${BASH_SOURCE[0]}" "$XA11Y_HOME/host.sh"
}

install_agent() {
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  cat >"$AGENT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$XA11Y_HOME/host.sh</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/$LABEL.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/$LABEL.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENT"
  local _
  for _ in $(seq 60); do
    curl -sf "http://127.0.0.1:$PORT/status" >/dev/null && break
    sleep 1
  done
  log "Appium listens on http://$ADDRESS:$PORT (LaunchAgent $LABEL, log in ~/Library/Logs/$LABEL.log)"
}

print_grants() {
  cat >&2 <<EOF

Appium needs two permissions for $1.
Grant them in System Settings > Privacy & Security, then restart Appium:
  Accessibility
  Screen & System Audio Recording
EOF
}

setup() {
  mkdir -p "$XA11Y_HOME"
  install_node
  install_appium
  install_driver
  write_env
  if [ "$SERVICE" = no ]; then
    log "Installed. Start Appium with: \"$XA11Y_HOME/host.sh\" run"
    print_grants "the terminal app that runs host.sh"
    return
  fi
  install_agent
  print_grants "$(node -p 'require("fs").realpathSync(process.execPath)')"
}

run() {
  export PATH NODE_OPTIONS=
  exec env APPIUM_HOME="$XA11Y_HOME/appium-home" "$XA11Y_HOME/appium/node_modules/.bin/appium" \
    --address "$ADDRESS" --port "$PORT" --log-timestamp
}

DRIVER=appium-xa11y-driver ADDRESS=127.0.0.1 PORT=4723 SERVICE=yes
COMMAND=setup
if [ "${1:-}" = run ]; then
  COMMAND=run
  shift
  # shellcheck source=/dev/null
  . "$XA11Y_HOME/host.env"
fi
while [ $# -gt 0 ]; do
  case "$1" in
    --driver) DRIVER="$2"; shift 2 ;;
    --address) ADDRESS="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --no-service) SERVICE=no; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
if [ "$COMMAND" = run ]; then
  run
else
  setup
fi
