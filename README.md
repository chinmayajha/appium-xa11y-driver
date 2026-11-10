# appium-xa11y-driver

An [Appium 3](https://appium.io) driver for native desktop apps on macOS, Linux and Windows. It reads the accessibility tree of the operating system (AXUIElement, AT-SPI2, UI Automation) through [xa11y](https://github.com/xa11y/xa11y) and serves it over WebDriver.

Appium and this driver run on the Host: the machine that shows the app. A Client (optics, a WebDriver test, an MCP server) connects over WebDriver. The terms are in [GLOSSARY.md](GLOSSARY.md). The design is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Install

Run the setup script for the OS of the Host. The script installs Appium 3 and the driver, and runs Appium as a service inside the Desktop session. You can run it again: it changes only what is missing.

```bash
hosts/linux/setup.sh
```

```bash
hosts/mac/setup.sh
```

| Option | Meaning |
|---|---|
| `--driver <path>` | Install the driver from a checkout. The default is the npm package. |
| `--address`, `--port` | Where Appium listens. The default is `127.0.0.1:4723`. Appium has no authentication, so do not open it to a network. |
| `--no-service` | Install only. Then start Appium in the Desktop session with `host.sh run`. |
| `--fixtures` (Linux) | Also install the apps that the conformance suite uses. |
| `--display`, `--size`, `--before`, `--replace` (Linux) | Use a given display; set the Xvfb size; run a command before each start; replace an older systemd user unit. |

On Linux the service is a systemd user unit, `appium-xa11y.service`, with linger on. It uses the X11 display that is there. If there is no display, it starts Xvfb with a cookie, the Openbox window manager, a D-Bus session and the AT-SPI bus. Docker and CI use the same script.

On macOS the service is a LaunchAgent, `appium-xa11y`. macOS gives Accessibility and Screen & System Audio Recording to the app that starts Appium, not to Node. The script shows which app that is. Grant both permissions in System Settings > Privacy & Security, then restart Appium.

To install by hand:

```bash
appium driver install --source=npm appium-xa11y-driver
```

## Capabilities

| Capability | Meaning |
|---|---|
| `platformName` | `Mac`, `Linux` or `Windows` |
| `appium:automationName` | `Xa11y` |
| `appium:app` | The app to start: an `.app` path or a bundle id on macOS, an executable on Linux and Windows. The session attaches to the new process. |
| `appium:appArguments` | Arguments for `appium:app` |
| `appium:appName` | Attach to a running app by its name. If you do not give `app` or `appName`, the session attaches to the frontmost app. |
| `appium:launchTimeout` | Milliseconds to wait for the app. The default is 20000. |
| `appium:terminateOnDelete` | Stop the apps that the session started when the session ends. The default is `true`. |

## Commands

Sessions; find one or more elements; click, send keys, clear, text, attribute, property, name (the role), rect, displayed, enabled, selected, active element; page source; screenshots of the Desktop and of an element; window rect; W3C actions with `pointer`, `key` and `wheel` sources; release actions; `activateApp`; `terminateApp`. The log shows the duration of each command.

| Locator strategy | Finds |
|---|---|
| `xpath` | XPath on the Page source |
| `accessibility id` | `@id`, then `@name` |
| `id`, `name` | `@id`, `@name` |
| `class name` | the role (the tag), for example `button` |
| `-xa11y selector` | an [xa11y selector](https://xa11y.dev/reference/selectors/), for example `button[name='OK']` |

`GET /window/rect` gives the Desktop: its size is the size of a screenshot. `POST /window/rect` moves and resizes the main window of the Session app and gives its new rect.

### `xa11y:` execute methods

| Method | Arguments |
|---|---|
| `xa11y: chord` | `keys`, for example `primary+a`, `cmd+shift+s`, `Enter`. `primary` is Cmd on macOS and Ctrl on Linux and Windows. |
| `xa11y: typeText` | `text`. It types into the frontmost app. |
| `xa11y: focusWindow`, `xa11y: closeWindow` | `name` (optional) |
| `xa11y: launch` | `app`, `arguments` (optional). The session switches to the new app. |
| `xa11y: switchApp` | `name` or `pid`. The session switches to the app, but does not bring it to the front. |
| `xa11y: listApps`, `xa11y: listWindows`, `xa11y: activeAppInfo` | none |

### Page source

Each element is one XML tag. The tag is the xa11y role (`button`, `text_field`, `menu_item`). Each element has these attributes:

| Attribute | Meaning |
|---|---|
| `type` | the role of the OS (`AXButton`, `push button`, `Button`) |
| `name`, `value`, `label` | the accessible name, value and description |
| `id` | the Stable id (AXIdentifier, AutomationId) if the app sets one. It is empty on Linux, because AT-SPI has no stable id. |
| `enabled`, `visible`, `focused`, `selected`, `checked` | the state |
| `clickable`, `checkable`, `editable`, `scrollable` | from the role and the actions of the element |
| `x`, `y`, `width`, `height` | the bounds in Desktop coordinates |

An element with no reliable bounds has no `x`, `y`, `width` and `height`, and has `visible="false"`. The tree contains the Session app and its windows. On macOS the menu bar is not in the tree.

### Coordinates

Bounds, screenshots and pointer actions use one space: the Desktop coordinates of the main display. On macOS the unit is the point, so the driver scales a Retina screenshot to points. A click at a pixel of the screenshot goes to that point. A pointer move outside the Desktop fails with `move target out of bounds`. Element clicks and element screenshots use the part of the element that its scroll areas and its window show.

### Input

The driver uses an Accessibility action first. Send keys to an editable element sets the text through the accessibility API, and a click on a button uses its press action. Then the app can stay behind other windows.

Chords, `xa11y: typeText`, W3C actions and clicks on elements with no press action are Raw input. The OS sends Raw input to the frontmost app. So the driver sends Raw input only when the Session app is frontmost. It checks before each event and does not bring the app to the front. If a different app is in front, for example a system alert, the command fails with `invalid element state` and sends nothing. To bring the Session app to the front, use `activateApp` or `xa11y: focusWindow`.

On macOS the driver sends wheel actions as continuous pixel scroll events, the same events that a trackpad sends. Tools that invert the mouse wheel change only line events, so a positive `deltaY` scrolls down on all Macs. On Linux the driver changes wheel deltas to scroll lines of 20 px.

After a pointer button is released, the driver waits until 50 ms have passed before the next pointer move or press. GTK 4 loses a click that comes in the same turn of its main loop as the previous release. The wait does not change a double click.

## Surfaces

| Surface | Prepare the Host | The Client connects to |
|---|---|---|
| This machine | `hosts/<os>/setup.sh` | `http://127.0.0.1:4723` |
| A local VM or a cloud machine | the same script in the VM | an SSH tunnel to `127.0.0.1:4723` |
| instabox | `instabox create --setup-file hosts/linux/setup.sh`, or a box from a saved snapshot | `instabox port-forward <box> 4723` |
| Docker | `docker build -f docker/linux/Dockerfile -t appium-xa11y-linux .`, then `docker run -p 127.0.0.1:4723:4723 appium-xa11y-linux` | `http://127.0.0.1:4723` |
| CI | the script on the runner ([.github/workflows/ci.yml](.github/workflows/ci.yml)) | `127.0.0.1:4723` on the runner |

### Where the Client runs

Each WebDriver command is one round trip. Through a tunnel, the time of a suite increases with the latency.

- To write and try a suite (optics live mode, natural-language mode, MCP), run the Client on your machine through the tunnel.
- For jobs and CI, run the Client on the Host. [examples/optics-ci.yml](examples/optics-ci.yml) runs optics on the Host. [examples/optics/](examples/optics/) has a macOS TextEdit suite and a Linux Calculator suite.

On an instabox box, the conformance suite took 18.0 s with the Client on the Host and 77.0 s with the Client on a laptop through the tunnel.

## Tests

The conformance suite is the test of the driver. It talks WebDriver to a running Appium and drives the fixture apps of the OS of the Host: TextEdit and Calculator on macOS; mousepad, gnome-calculator and gtk3-widget-factory on Linux; Notepad and Calculator on Windows.

```bash
npm run conformance -- --url http://127.0.0.1:4723
```

Add `--os linux`, `--os mac` or `--os windows` when the Client and the Host have different operating systems, for example through a tunnel. The suite uses no mocks.

## Adding an OS

Read [ARCHITECTURE.md](ARCHITECTURE.md#adding-an-operating-system). In short: write a `Platform` in `src/platforms/`, add fixture apps to the conformance suite, write `hosts/<os>/setup.sh`, and add a CI job. For a call that the OS cannot do yet, throw `notSupportedYet('<os>', '<call>')`: the Client gets `Not supported yet on <os>: <call>`. Do not use the behavior of a different OS. The OS is supported when the conformance suite passes on a real Host.

## Known gaps

- Windows: the adapter is not proven on a real Host. The Frontmost check, activation, the wheel and key release are not supported yet.
- Linux: only X11. On Wayland, GTK 4 elements have no bounds.
- Linux: GTK 4 apps are proven on GTK 4.18 (Debian 13). On GTK 4.14 (Ubuntu 24.04), GTK 4 apps have no window and their elements have no bounds, so window commands, pointer actions and element screenshots fail. GTK 3 apps work on Ubuntu 24.04. Docker and CI use Debian 13.
- Linux: elements have no Stable id.
- Linux, GTK 4: AT-SPI runs an action later in the main loop of the app. If you mix an Accessibility click and Raw input, the Raw input can arrive first.
- macOS: a second process cannot take a screenshot while a different process holds a capture.

[docs/xa11y-gaps.md](docs/xa11y-gaps.md) has each xa11y limit with a short repro, and the problems that come from other parts.

## License

MIT
