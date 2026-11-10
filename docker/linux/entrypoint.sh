#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
Xvfb "$DISPLAY" -screen 0 1280x1024x24 -ac &
sleep 1
fluxbox >/dev/null 2>&1 &

eval "$(dbus-launch --sh-syntax)"
export NO_AT_BRIDGE=0 AT_SPI_CLIENT=true ACCESSIBILITY_ENABLED=1 GSK_RENDERER=cairo
/usr/libexec/at-spi-bus-launcher --launch-immediately &
sleep 1
/usr/libexec/at-spi2-registryd &
sleep 1
for prop in IsEnabled ScreenReaderEnabled; do
  dbus-send --session --print-reply --dest=org.a11y.Bus /org/a11y/bus \
    org.freedesktop.DBus.Properties.Set string:org.a11y.Status string:"$prop" variant:boolean:true >/dev/null \
    || echo "org.a11y.Status.$prop is not registered yet"
done

exec "$@"
