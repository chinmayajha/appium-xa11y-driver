#!/usr/bin/env bash
# Prepares a macOS Host for the xa11y driver. Safe to run again: it changes only what is missing.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.23.3}"
APPIUM_VERSION="${APPIUM_VERSION:-3.9.0}"
XA11Y_HOME="${XA11Y_HOME:-$HOME/Library/Application Support/appium-xa11y}"
LABEL=appium-xa11y
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
ALL_GRANTS='Accessibility and Screen & System Audio Recording'
# osascript gets the grants of the terminal app that runs this script, as host.sh run does.
TERMINAL_GRANTS="ObjC.import('ApplicationServices'); ObjC.bindFunction('CGPreflightScreenCaptureAccess', ['bool', []]);
[\$.AXIsProcessTrusted() ? '' : 'Accessibility', \$.CGPreflightScreenCaptureAccess() ? '' : 'Screen & System Audio Recording'].filter(Boolean).join(' and ')"

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
    process.exit(a >= 24 || (a === 22 && b >= 12) || (a === 20 && b >= 19) ? 0 : 1);'
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
    # An npm spec with a version or tag after the name is a pin, so only a bare name follows new releases.
    if [ "$source" = npm ] && [[ "${spec#@}" != *@* ]]; then
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
  printf 'DRIVER=%q\nADDRESS=%q\nPORT=%q\nPATH=%q\n' "$DRIVER" "$ADDRESS" "$PORT" "$XA11Y_HOME/node/bin:$PATH" >"$XA11Y_HOME/host.env"
  install -m 0755 "${BASH_SOURCE[0]}" "$XA11Y_HOME/host.sh"
}

base_url() {
  case "$ADDRESS" in
    0.0.0.0 | ::) printf 'http://127.0.0.1:%s' "$PORT" ;;
    *:*) printf 'http://[%s]:%s' "$ADDRESS" "$PORT" ;;
    *) printf 'http://%s:%s' "$ADDRESS" "$PORT" ;;
  esac
}

probe_url() { printf '%s/status' "$(base_url)"; }

status_url() { printf '%s/xa11y/status' "$(base_url)"; }

port_holder() {
  local own="${1:-none}" pids pid rc=0
  pids=$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  pid=$(printf '%s\n' "$pids" | grep -vx -e "$own" -e '' | sed -n 1p || true)
  if [ -n "$pid" ]; then
    printf 'pid %s (%s)' "$pid" "$(ps -o command= -p "$pid")"
    return 0
  fi
  printf '%s\n' "$pids" | grep -x -e "$own" > /dev/null && return 1
  # lsof does not show the sockets of other users, but a connection still reaches them.
  curl -s -o /dev/null --max-time 2 "$(probe_url)" || rc=$?
  [ "$rc" = 7 ] && return 1
  printf 'a process of a different user'
}

require_free_port() {
  local holder
  holder=$(port_holder "${1:-}") || return 0
  die "port $PORT is in use by $holder. Stop that process, or run setup.sh again with --port <a free port>"
}

agent_pid() { launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | awk '$1 == "pid" { print $3 }' || true; }

wait_for_appium() {
  local _ pid
  for _ in $(seq 60); do
    pid=$(agent_pid)
    if [ -n "$pid" ] && lsof -nP -a -p "$pid" -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      curl -sf "$(probe_url)" | grep '"ready"' > /dev/null && return 0
    fi
    sleep 1
  done
  return 1
}

running() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null; }

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

install_agent() {
  local program log old _
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
  old=$(agent_pid)
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  for _ in $(seq 50); do
    running "$old" || break
    sleep 0.2
  done
  running "$old" && die "the old LaunchAgent (pid $old) did not stop"
  require_free_port
  launchctl bootstrap "gui/$(id -u)" "$AGENT"
  wait_for_appium || die "Appium did not start. See ~/Library/Logs/$LABEL.log"
  log "Appium listens on http://$ADDRESS:$PORT (LaunchAgent $LABEL, log in ~/Library/Logs/$LABEL.log)"
}

open_pane() { open "x-apple.systempreferences:com.apple.preference.security?$1" || true; }

ask_grants() {
  log "Grant $1 to $2 in System Settings > Privacy & Security, then $3"
  case "$1" in *Accessibility*) open_pane Privacy_Accessibility ;; esac
  case "$1" in *Recording*) open_pane Privacy_ScreenCapture ;; esac
}

show_permissions() {
  local reply code
  reply=$(curl -s -w '\n%{http_code}' "$(status_url)") || die "Appium does not answer $(status_url). See ~/Library/Logs/$LABEL.log"
  code=${reply##*$'\n'}
  if [ "$code" != 200 ]; then
    log "$(status_url) gives HTTP $code, so this driver does not show its permissions"
    ask_grants "$ALL_GRANTS" "$XA11Y_HOME/node/bin/node" "restart Appium: launchctl kickstart -k gui/$(id -u)/$LABEL"
    return
  fi
  printf '%s' "${reply%$'\n'*}" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const v = JSON.parse(s).value;
      console.log(v.next ?? "Appium has the permissions that it needs.");
      if (!v.accessibility) console.log("Privacy_Accessibility");
      if (!v.screenRecording) console.log("Privacy_ScreenCapture");
    });' | {
    local line pane
    read -r line
    log "$line"
    while read -r pane; do
      open_pane "$pane"
    done
  }
}

show_terminal_permissions() {
  local missing
  missing=$(osascript -l JavaScript -e "$TERMINAL_GRANTS" 2>/dev/null) || missing=$ALL_GRANTS
  [ -z "$missing" ] || ask_grants "$missing" "the terminal app that runs host.sh" "start Appium"
}

setup() {
  [ "$SERVICE" = no ] || require_free_port "$(agent_pid)"
  mkdir -p "$XA11Y_HOME"
  install_node
  install_appium
  install_driver
  write_env
  if [ "$SERVICE" = no ]; then
    log "Installed. Start Appium with: \"$XA11Y_HOME/host.sh\" run"
    show_terminal_permissions
    return
  fi
  install_agent
  show_permissions
}

run() {
  export PATH NODE_OPTIONS=
  require_free_port
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
elif [ -f "$XA11Y_HOME/host.env" ]; then
  # When setup runs again, it keeps the options of the last setup, and only the flags given now change them.
  keep_path=$PATH
  # shellcheck source=/dev/null
  . "$XA11Y_HOME/host.env"
  PATH=$keep_path
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
# host.env keeps DRIVER for later runs from any folder, so a local path must be absolute.
if [ -d "$DRIVER" ]; then
  DRIVER=$(cd "$DRIVER" && pwd)
fi
if [ "$COMMAND" = run ]; then
  run
else
  setup
fi
