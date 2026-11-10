# appium-xa11y-driver

An [Appium 3](https://appium.io) driver for native desktop apps on macOS, Windows and Linux. It reads the platform accessibility tree (AXUIElement, UI Automation, AT-SPI2) through [xa11y](https://github.com/xa11y/xa11y) and serves it over WebDriver.

Appium and this driver run on the machine that shows the app. Clients connect over WebDriver from anywhere.

## Install

```bash
appium driver install --source=npm appium-xa11y-driver
```

From a checkout:

```bash
npm install && npm run build
appium driver install --source=local /path/to/appium-xa11y-driver
```

### macOS permissions

macOS checks the app that is responsible for the Node process, not Node itself. Turn on that app in System Settings → Privacy & Security, under both **Accessibility** and **Screen & System Audio Recording**:

| Appium started from | Grant |
|---|---|
| Terminal, iTerm, an IDE terminal | That terminal app |
| launchd (LaunchAgent) | The `node` binary |
| Another app that spawns Node | That app |

## Capabilities

| Capability | Description |
|---|---|
| `platformName` | `Mac`, `Windows` or `Linux` |
| `appium:automationName` | `Xa11y` |
| `appium:app` | App to start: an `.app` path or bundle id on macOS, an executable elsewhere. The session attaches to the new process. |
| `appium:appArguments` | Arguments for `appium:app` |
| `appium:appName` | Attach to a running app by name. Without `app` and `appName` the session attaches to the foreground app. |
| `appium:launchTimeout` | Milliseconds to wait for the app (default 20000) |
| `appium:terminateOnDelete` | Stop apps the session started when it ends (default `true`) |

## Locators

| Strategy | Matches |
|---|---|
| `xpath` | XPath over the page source |
| `accessibility id` | `@id`, then `@name` |
| `id` / `name` | `@id` / `@name` |
| `class name` | The role (tag name), e.g. `button`, `text_area` |
| `-xa11y selector` | An [xa11y selector](https://xa11y.dev/reference/selectors/), e.g. `button[name='OK']` |

## Page source

Each element is one XML tag named after its normalized role (`button`, `text_field`, `menu_item`, ...). Attributes:

| Attribute | Meaning |
|---|---|
| `name`, `value`, `label` | Accessible name, value and description |
| `id` | Stable platform id (AXIdentifier, AutomationId) when the app sets one |
| `type` | The platform role (`AXButton`, `Button`, `push button`) |
| `enabled`, `visible`, `focused`, `selected`, `checked` | State |
| `clickable`, `checkable`, `editable`, `scrollable` | Derived from the role and the actions the element supports |
| `x`, `y`, `width`, `height` | Bounds in desktop coordinates |

The tree is scoped to the attached app and its windows. On macOS the menu bar is not in the tree.

## Coordinates

Bounds, screenshots and pointer actions use one space: desktop coordinates of the primary display (points on macOS, so a Retina screenshot is scaled to points). A tap at a pixel of the screenshot lands on that point. Element clicks and element screenshots use the part of the element that its scroll view and window show, because a text area can be taller than the screen.

## Input

Send keys to an editable element puts the text in through the accessibility API, so the app can stay in the background.

Chords, `xa11y: typeText` and W3C actions are synthetic input, and the OS sends them to the foreground app. Before each one, the driver brings the app's window to the front. If another app keeps the foreground (for example, a system alert), the command fails with `invalid element state` and sends no input.

On macOS, wheel actions are sent as continuous pixel scroll events, the same kind a trackpad sends. Tools that invert the mouse wheel (for example, Unnatural Scroll Wheels) change only line events, so a positive `deltaY` scrolls down on every Mac. On Windows and Linux, wheel deltas are converted to scroll lines of 20 px.

## Commands

Sessions; find element(s); click, send keys, clear, text, attribute, rect, displayed, enabled, selected, active element; page source; screenshots of the screen and of an element; window rect; W3C actions with `pointer`, `key` and `wheel` sources; `activateApp` and `terminateApp`.

`execute` methods:

| Method | Arguments |
|---|---|
| `xa11y: chord` | `keys`, e.g. `cmd+shift+s`, `ctrl+a`, `Enter`; `primary+a` is `cmd+a` on macOS and `ctrl+a` on Windows and Linux |
| `xa11y: typeText` | `text` |
| `xa11y: focusWindow`, `xa11y: closeWindow` | `name` (optional) |
| `xa11y: launch` | `app`, `arguments` (optional); the session switches to it |
| `xa11y: switchApp` | `name` or `pid` |
| `xa11y: listApps`, `xa11y: listWindows`, `xa11y: activeAppInfo` | none |

Every command is logged with its duration.

## Tests

`npm test` drives TextEdit on macOS and needs the permissions above.

`scripts/webdriver-smoke.mjs` runs the main commands over WebDriver against a running server: `node scripts/webdriver-smoke.mjs <server url> <app> <text field xpath> [platformName]`.

### Linux in Docker

`docker/linux` builds Ubuntu 24.04 with Xvfb, the AT-SPI bus, GNOME Text Editor and Appium with this driver:

```bash
docker build -f docker/linux/Dockerfile -t appium-xa11y-linux .
docker run --rm -p 127.0.0.1:4723:4723 appium-xa11y-linux
node scripts/webdriver-smoke.mjs http://127.0.0.1:4723 gnome-text-editor "//text" Linux
```

## Adding an OS

All OS-specific behavior is in `src/platforms`. The driver selects one `Platform` when a session starts (`currentPlatform()` in `src/platforms/index.ts`). The tree, focus, clicks, typing and screenshots go through xa11y on every OS.

1. Add `src/platforms/<os>.ts`. Export a `Platform`: how to launch an app and get its pid, how to send a wheel event, how to release keys, the `primary` chord modifier, and a permission hint for session errors.
2. Use the helpers in `common.ts` where the xa11y behavior is correct for the OS.
3. For a call that the OS cannot do yet, throw `notSupportedYet('<os>', '<call>')`. The client gets `Not supported yet on <os>: <call>`. Do not fall back to the behavior of a different OS.
4. Add the module to `PLATFORMS` in `src/platforms/index.ts`.
5. Add the OS to the CI matrix with an app that the OS includes.

## License

MIT
