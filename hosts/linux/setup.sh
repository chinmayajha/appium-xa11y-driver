#!/usr/bin/env bash
# Prepares a Linux Host for the xa11y driver. Safe to run again: it changes only what is missing.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.23.3}"
APPIUM_VERSION="${APPIUM_VERSION:-3.9.0}"
XA11Y_HOME="${XA11Y_HOME:-$HOME/.local/share/appium-xa11y}"
UNIT=appium-xa11y.service
BASE_PACKAGES="at-spi2-core dbus dbus-x11 libglib2.0-bin xauth xvfb openbox curl ca-certificates xz-utils fonts-dejavu-core"
FIXTURE_PACKAGES="mousepad gnome-calculator gtk-3-examples gtk-4-examples"

usage() {
  cat <<'EOF'
Usage: setup.sh [options]        install Appium 3 and the driver, and run Appium as a service
       host.sh run               start the Desktop session parts and Appium in this shell

Options:
  --driver <path|npm spec>   the driver to install (default: appium-xa11y-driver from npm)
  --fixtures                 also install the apps that the conformance suite drives
  --address <ip>             where Appium listens (default: 127.0.0.1; Appium has no authentication)
  --port <port>              default: 4723
  --display <:n>             use this display; default: the first one in /tmp/.X11-unix, else Xvfb on :99
  --size <WxH>               the Xvfb screen size (default: 1440x900)
  --before <command>         run this before each start, for example a command that starts a desktop
  --replace <unit>           stop and disable this older systemd user unit, and keep it as <unit>.replaced
  --no-service               install only; start Appium with: host.sh run
EOF
}

log() { printf '\033[1m==>\033[0m %s\n' "$*" >&2; }
die() { printf 'setup.sh: %s\n' "$*" >&2; exit 1; }

as_root() {
  if [ "$(id -u)" = 0 ]; then
    "$@"
  elif sudo -n true 2>/dev/null; then
    sudo -n "$@"
  else
    die "this step needs root. Run it yourself, then run setup.sh again: $*"
  fi
}

installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'ok installed'; }

install_packages() {
  local missing=() p
  for p in "$@"; do
    installed "$p" || missing+=("$p")
  done
  [ ${#missing[@]} -eq 0 ] && return
  log "Installing ${missing[*]}"
  as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}"
}

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
    x86_64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) die "no Node.js build for $(uname -m)" ;;
  esac
  local name="node-v$NODE_VERSION-linux-$arch.tar.xz" url="https://nodejs.org/dist/v$NODE_VERSION"
  log "Installing Node.js $NODE_VERSION in $XA11Y_HOME/node"
  curl -fsSL -o "$XA11Y_HOME/$name" "$url/$name"
  curl -fsSL -o "$XA11Y_HOME/SHASUMS256.txt" "$url/SHASUMS256.txt"
  (cd "$XA11Y_HOME" && grep "  $name\$" SHASUMS256.txt | sha256sum -c --status) \
    || die "the Node.js download does not match SHASUMS256.txt"
  rm -rf "$XA11Y_HOME/node" && mkdir -p "$XA11Y_HOME/node"
  tar -xJ --strip-components=1 -C "$XA11Y_HOME/node" -f "$XA11Y_HOME/$name"
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
  {
    printf 'ADDRESS=%q\nPORT=%q\nDISPLAY_WANTED=%q\nSIZE=%q\nBEFORE=%q\nFIXTURES=%q\n' \
      "$ADDRESS" "$PORT" "$DISPLAY_WANTED" "$SIZE" "$BEFORE" "$FIXTURES"
    printf 'PATH=%q\n' "$XA11Y_HOME/node/bin:$PATH"
  } >"$XA11Y_HOME/host.env"
  install -m 0755 "${BASH_SOURCE[0]}" "$XA11Y_HOME/host.sh"
}

has_user_systemd() { systemctl --user show-environment >/dev/null 2>&1; }

replace_unit() {
  local old="$HOME/.config/systemd/user/$1"
  [ -f "$old" ] || return 0
  log "Replacing the systemd user unit $1"
  systemctl --user disable --now "$1" >/dev/null 2>&1 || true
  mv "$old" "$old.replaced"
}

install_service() {
  [ -n "$REPLACE" ] && replace_unit "$REPLACE"
  if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != yes ]; then
    log "Turning on linger, so the service runs without a login"
    as_root loginctl enable-linger "$(id -un)"
  fi
  mkdir -p "$HOME/.config/systemd/user"
  cat >"$HOME/.config/systemd/user/$UNIT" <<EOF
[Unit]
Description=Appium with the xa11y driver in the Desktop session
After=dbus.socket

[Service]
ExecStart="$XA11Y_HOME/host.sh" run
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable "$UNIT" >/dev/null 2>&1
  systemctl --user restart "$UNIT"
  wait_for_appium || die "Appium did not start. See: journalctl --user -u $UNIT"
  log "Appium listens on http://$ADDRESS:$PORT (service $UNIT)"
}

probe_url() {
  case "$ADDRESS" in
    0.0.0.0 | ::) printf 'http://127.0.0.1:%s/status' "$PORT" ;;
    *:*) printf 'http://[%s]:%s/status' "$ADDRESS" "$PORT" ;;
    *) printf 'http://%s:%s/status' "$ADDRESS" "$PORT" ;;
  esac
}

wait_for_appium() {
  local _
  for _ in $(seq 60); do
    curl -sf "$(probe_url)" >/dev/null && return 0
    sleep 1
  done
  return 1
}

setup() {
  mkdir -p "$XA11Y_HOME"
  local packages="$BASE_PACKAGES"
  [ "$FIXTURES" = yes ] && packages="$packages $FIXTURE_PACKAGES"
  # shellcheck disable=SC2086
  install_packages $packages
  install_node
  install_appium
  install_driver
  write_env
  if [ "$SERVICE" = no ] || ! has_user_systemd; then
    log "Installed. Start Appium inside the Desktop session with: $XA11Y_HOME/host.sh run"
    return
  fi
  install_service
}

wait_for_socket() {
  local _
  for _ in $(seq 100); do
    [ -S "/tmp/.X11-unix/X${1#:}" ] && return 0
    sleep 0.3
  done
  return 1
}

live_display() {
  local pid
  pid=$(tr -d ' \n' < "/tmp/.X$1-lock" 2>/dev/null) && [ -n "$pid" ] || return 1
  case "$(cat "/proc/$pid/comm" 2>/dev/null)" in X*) return 0 ;; *) return 1 ;; esac
}

# The socket can exist before Xvfb accepts clients, and then openbox exits at once.
start_wm() {
  local _ pid
  pgrep -u "$(id -u)" -x openbox >/dev/null && return
  for _ in $(seq 20); do
    DISPLAY="$1" openbox >/dev/null 2>&1 &
    pid=$!
    sleep 0.5
    kill -0 "$pid" 2>/dev/null && return
  done
  die "openbox did not start on $1"
}

start_xvfb() {
  local display=:99 auth="$XA11Y_HOME/Xauthority"
  if [ ! -s "$auth" ]; then
    (umask 077 && xauth -q -f "$auth" add "$display" . "$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')")
  fi
  export XAUTHORITY="$auth"
  if ! live_display 99; then
    rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
    Xvfb "$display" -screen 0 "${SIZE}x24" -auth "$auth" -nolisten tcp >/dev/null 2>&1 &
    wait_for_socket "$display" || die "Xvfb did not start on $display"
  fi
  start_wm "$display"
  DISPLAY="$display"
}

pick_display() {
  if [ -n "$DISPLAY_WANTED" ]; then
    wait_for_socket "$DISPLAY_WANTED" || die "no X server on $DISPLAY_WANTED"
    DISPLAY="$DISPLAY_WANTED"
    return
  fi
  local s
  for s in /tmp/.X11-unix/X*; do
    if [ -S "$s" ] && live_display "${s##*X}"; then
      DISPLAY=":${s##*X}"
      [ "$DISPLAY" = :99 ] && [ -z "${XAUTHORITY:-}" ] && export XAUTHORITY="$XA11Y_HOME/Xauthority"
      return
    fi
  done
  start_xvfb
}

session_bus() {
  if [ -S "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/bus" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/bus"
  elif [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
    eval "$(dbus-launch --sh-syntax)"
  fi
}

a11y_bus() {
  local _
  for _ in $(seq 20); do
    gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus --method org.a11y.Bus.GetAddress >/dev/null 2>&1 && break
    { pgrep -u "$(id -u)" -f at-spi-bus-launcher >/dev/null || /usr/libexec/at-spi-bus-launcher --launch-immediately >/dev/null 2>&1 & }
    sleep 0.5
  done
  local prop
  for prop in IsEnabled ScreenReaderEnabled; do
    gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
      --method org.freedesktop.DBus.Properties.Set org.a11y.Status "$prop" '<true>' >/dev/null \
      || die "org.a11y.Status.$prop could not be set: the AT-SPI bus is not running"
  done
}

run() {
  export PATH
  [ -n "$BEFORE" ] && bash -c "$BEFORE"
  pick_display
  export DISPLAY NO_AT_BRIDGE=0 ATSPI_DISABLE_P2P=1 GDK_BACKEND=x11 XDG_SESSION_TYPE=x11 NODE_OPTIONS=
  session_bus
  a11y_bus
  if [ "$FIXTURES" = yes ] && command -v gsettings >/dev/null; then
    gsettings set org.xfce.mousepad.preferences.file session-restore never 2>/dev/null || true
  fi
  exec env APPIUM_HOME="$XA11Y_HOME/appium-home" "$XA11Y_HOME/appium/node_modules/.bin/appium" \
    --address "$ADDRESS" --port "$PORT" --log-timestamp
}

DRIVER=appium-xa11y-driver FIXTURES=no ADDRESS=127.0.0.1 PORT=4723 DISPLAY_WANTED='' SIZE=1440x900 BEFORE='' REPLACE='' SERVICE=yes
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
    --fixtures) FIXTURES=yes; shift ;;
    --address) ADDRESS="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --display) DISPLAY_WANTED="$2"; shift 2 ;;
    --size) SIZE="$2"; shift 2 ;;
    --before) BEFORE="$2"; shift 2 ;;
    --replace) REPLACE="$2"; shift 2 ;;
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
