#!/usr/bin/env bash
# Prepares a macOS Host for the xa11y driver. Safe to run again: it changes only what is missing.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.23.3}"
APPIUM_VERSION="${APPIUM_VERSION:-3.9.0}"
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

own_node_ok() { [ "$("$XA11Y_HOME/node/bin/node" -v 2>/dev/null)" = "v$NODE_VERSION" ]; }

install_node() {
  export PATH="$XA11Y_HOME/node/bin:$PATH"
  # The service's Node receives the Accessibility and Screen Recording grants, so it must not be the user's own Node.
  if [ "$SERVICE" = no ]; then
    node_ok && return
  fi
  own_node_ok && return
  local arch
  case "$(uname -m)" in
    arm64) arch=arm64 ;;
    x86_64) arch=x64 ;;
    *) die "no Node.js build for $(uname -m)" ;;
  esac
  local name="node-v$NODE_VERSION-darwin-$arch.tar.gz" url="https://nodejs.org/dist/v$NODE_VERSION"
  log "Installing Node.js $NODE_VERSION in $XA11Y_HOME/node"
  curl -fsSL -o "$XA11Y_HOME/$name" "$url/$name"
  curl -fsSL -o "$XA11Y_HOME/SHASUMS256.txt" "$url/SHASUMS256.txt"
  (cd "$XA11Y_HOME" && grep "  $name\$" SHASUMS256.txt | shasum -a 256 -c --status) \
    || die "the Node.js download does not match SHASUMS256.txt"
  rm -rf "$XA11Y_HOME/node" && mkdir -p "$XA11Y_HOME/node"
  tar -xz --strip-components=1 -C "$XA11Y_HOME/node" -f "$XA11Y_HOME/$name"
  rm -f "$XA11Y_HOME/$name" "$XA11Y_HOME/SHASUMS256.txt"
}

appium() { APPIUM_HOME="$XA11Y_HOME/appium-home" "$XA11Y_HOME/appium/node_modules/.bin/appium" "$@"; }

install_appium() {
  if [ "$(appium --version 2>/dev/null)" != "$APPIUM_VERSION" ]; then
    log "Installing Appium $APPIUM_VERSION in $XA11Y_HOME/appium"
    npm install --prefix "$XA11Y_HOME/appium" --no-audit --no-fund --loglevel=error "appium@$APPIUM_VERSION" >/dev/null
  fi
}

installed_driver() {
  appium driver list --installed --json 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let d;
      try { d = JSON.parse(s).xa11y; } catch {}
      process.stdout.write(d ? d.installType + " " + d.installSpec : "");
    });'
}

install_driver() {
  local source=npm spec="$DRIVER"
  if [ -d "$DRIVER" ]; then
    source=local
    spec="$(cd "$DRIVER" && pwd)"
    log "Building the driver in $spec"
    (cd "$spec" && { [ -d node_modules ] || npm ci --no-audit --no-fund --loglevel=error; } && npm run build >/dev/null)
  fi
  local current out
  current=$(installed_driver)
  if [ "$current" = "$source $spec" ]; then
    if [ "$source" = npm ]; then
      appium driver update xa11y >/dev/null 2>&1 || true
    fi
    log "The driver is installed from $source: $spec"
    return
  fi
  if [ -n "$current" ]; then
    log "Removing the driver installed from ${current/ /: }"
    out=$(appium driver uninstall xa11y 2>&1) || die "the old driver did not uninstall: $out"
  fi
  log "Installing the driver from $source: $spec"
  out=$(appium driver install --source="$source" "$spec" 2>&1) || die "the driver did not install: $out"
}

write_env() {
  printf 'ADDRESS=%q\nPORT=%q\nPATH=%q\n' "$ADDRESS" "$PORT" "$XA11Y_HOME/node/bin:$PATH" >"$XA11Y_HOME/host.env"
  install -m 0755 "${BASH_SOURCE[0]}" "$XA11Y_HOME/host.sh"
}

probe_url() {
  case "$ADDRESS" in
    0.0.0.0 | ::) printf 'http://127.0.0.1:%s/status' "$PORT" ;;
    *:*) printf 'http://[%s]:%s/status' "$ADDRESS" "$PORT" ;;
    *) printf 'http://%s:%s/status' "$ADDRESS" "$PORT" ;;
  esac
}

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

install_agent() {
  local program log
  program=$(xml_escape "$XA11Y_HOME/host.sh")
  log=$(xml_escape "$HOME/Library/Logs/$LABEL.log")
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
  cat >"$AGENT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$program</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENT"
  local _
  for _ in $(seq 60); do
    curl -sf "$(probe_url)" >/dev/null && break
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
  print_grants "$("$XA11Y_HOME/node/bin/node" -p 'require("fs").realpathSync(process.execPath)')"
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
  here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  [ -f "$here/host.env" ] && XA11Y_HOME="$here"
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
