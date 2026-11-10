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

Bounds, screenshots and pointer actions use one space: desktop coordinates of the primary display (points on macOS, so a Retina screenshot is scaled to points). A tap at a pixel of the screenshot lands on that point.

## Input

Send keys to an editable element puts the text in through the accessibility API, so the app can stay in the background.

Chords, `xa11y: typeText` and W3C actions are synthetic input, and the OS sends them to the foreground app. Before each one, the driver brings the app's window to the front. If another app keeps the foreground (for example, a system alert), the command fails with `invalid element state` and sends no input.

## Commands

Sessions; find element(s); click, send keys, clear, text, attribute, rect, displayed, enabled, selected, active element; page source; screenshots of the screen and of an element; window rect; W3C actions with `pointer`, `key` and `wheel` sources (wheel deltas are converted to scroll lines of 20 px); `activateApp` and `terminateApp`.

`execute` methods:

| Method | Arguments |
|---|---|
| `xa11y: chord` | `keys`, e.g. `cmd+shift+s`, `ctrl+a`, `Enter` |
| `xa11y: typeText` | `text` |
| `xa11y: focusWindow`, `xa11y: closeWindow` | `name` (optional) |
| `xa11y: launch` | `app`, `arguments` (optional); the session switches to it |
| `xa11y: switchApp` | `name` or `pid` |
| `xa11y: listApps`, `xa11y: listWindows`, `xa11y: activeAppInfo` | none |

Every command is logged with its duration.

## Tests

`npm test` drives TextEdit on macOS and needs the permissions above.

## License

MIT
