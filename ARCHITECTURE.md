# Architecture

Terms are defined in [GLOSSARY.md](GLOSSARY.md). Decisions are in [docs/adr/](docs/adr/).

## Shape

```
Client (optics, WebDriver tests, MCP)
   │  WebDriver over HTTP (direct, or through an SSH tunnel)
   ▼
Appium 3 ─▶ Xa11yDriver            translates WebDriver commands, nothing else
               │
   ┌───────────┼─────────────┬──────────────┐
   ▼           ▼             ▼              ▼
 Target       Tree          Input          Screen
 Session app  Page source,  Frontmost      Screenshots in
 launch,      find, element guard, W3C     Desktop coordinates
 attach,      handles,      actions,
 switch       bounds        chords, typing
   └───────────┴──── Platform seam ─────────┘
                mac │ linux │ windows
                    ▼
                  xa11y  (UI Automation, AXUIElement, AT-SPI)
```

The external seam is the WebDriver protocol. Appium owns it. Every module below the driver is internal. Tests go through WebDriver, never past it.

## Modules

| Module | Interface | Hides |
|---|---|---|
| `Xa11yDriver` (`driver.ts`) | Appium `BaseDriver` commands and `xa11y:` execute methods | Only translation: WebDriver arguments to module calls, module errors to WebDriver errors |
| `Target` | `launch(app, args)`, `attach({ name, pid })`, `activate()`, `activateOrLaunch(appId)`, `terminate(appId)`, `window(name?)`, `focusWindow(name?)`, `closeWindow(name?)`, `moveWindow(rect)`, `windows()`, `list()`, `app`, `terminateLaunched()` | Process start and stop per OS, attach by pid or name, a running instance before a new launch, the wait for the first window, the list of launched pids |
| `Tree` | `source()`, `find(strategy, selector, context?, wait)`, `focused()`, `element(id)`, `rect(id)`, `visibleRect(id)`, `visibleCenter(id)`, `attribute(id, name)`, `state(id)`, `windowRect()` | The Page source contract, XPath over the snapshot, element handles and their identity (a handle of another app, or of another element at the same place, is stale), bounds in Desktop coordinates (toolkit corrections, hidden-element sentinels) |
| `Input` | `click(element)`, `type(text, element?)`, `clear(element)`, `chord(keys)`, `perform(actions)`, `release()` | Accessibility action first, Raw input second; the Frontmost guard on every Raw input path; modifier release; wheel; key names |
| `Screen` | `capture()`, `capture(rect)`, `desktop()` | Scaling to Desktop coordinates; element and region images cut from one full capture |
| `Platform` | `os`, `primaryModifier`, `permissionHint`, `launch`, `isFrontmost`, `frontmostName`, `activate`, `wheel`, `pressKey`, `releaseKeys`, `windowShadow`, `elementRect`, `stableId`, `identity`, `platformRole`, `scrollTypes`, `settleAfterReleaseMs`, `typeTextMovesCaret`, `terminate`, `startedAt`, `runningPid` | Everything that differs per OS and xa11y does not cover |

Rules:
- **Raw input exists only inside `Input`.** No other module calls `inputSim()`. The Frontmost guard is private to `Input`, so no path can skip it. The guard only checks: it never activates a window. `Target` activates the Session app when the session starts, on `xa11y: launch`, `xa11y: focusWindow` and `activateApp`. The guard checks again between the events of one action sequence; checks closer together than 100 ms share one result.
- **A pointer move outside the Desktop fails** with `move target out of bounds`. The driver does not clamp it to the screen edge.
- **Coordinates exist only as Desktop coordinates.** `Tree.rect`, pointer input and `Screen` use the same space. Conversion happens once, in `Tree` (bounds) and `Screen` (images).
- **The Page source is a contract.** Tags are xa11y roles. Attributes: `type`, `name`, `value`, `label`, `id`, `enabled`, `visible`, `focused`, `selected`, `checked`, `clickable`, `checkable`, `editable`, `scrollable`, `x`, `y`, `width`, `height`. An element with no reliable bounds has no `x`/`y`/`width`/`height` and `visible="false"`. Changes are breaking changes for clients.
- **`Platform` is the only place that branches on the OS.** In `src/`, no `process.platform` outside `platforms/`.

## Platform seam

The seam has adapters for macOS, Linux and Windows. An adapter reports "Not supported yet on <os>: <call>" for a call that is not proven on its OS, and never falls back to the behaviour of another OS.

| Call | macOS | Linux (X11) | Windows |
|---|---|---|---|
| `launch` | `open -n -a`, then the newest pid of the bundle executable; of several copies of a bundle id, the one in an app folder | spawn, detached | spawn, detached; when the process exits with no window (a launcher such as `calc.exe`), the new app whose parent is that process |
| `isFrontmost` | the pid of the xa11y foreground app | one window of the app is `active` (xa11y reads the EWMH active window) | the pid of the xa11y foreground app |
| `activate` | xa11y window activate; an error is ignored when the app is then frontmost | xa11y window activate (EWMH `_NET_ACTIVE_WINDOW` message) | xa11y window activate |
| `wheel` | continuous pixel scroll events | xa11y wheel lines, 20 px to a line | xa11y wheel lines with `dy` negated (xa11y gap 17) |
| `pressKey` | xa11y key tap; after an arrow, Home, End, page or F key, post a flags change without Fn and keypad | xa11y key tap | xa11y key tap |
| `releaseKeys` | xa11y key up, then post a flags change without the released modifiers (and Fn and keypad, as `pressKey` does) and wait until the event source reports them up | xa11y key up | xa11y key up |
| `elementRect` | xa11y bounds | xa11y bounds; `INT_MIN` sentinels → none; GTK 4: see below | xa11y bounds |
| `stableId` | AX identifier | none (xa11y gives the AT-SPI object path, which changes each time the app starts) | AutomationId (xa11y gives the window handle of a Win32 control, which changes each time the app starts) |
| `identity` | AX identifier; when it is empty, the handle checks the name | D-Bus name and AT-SPI object path. They are the same while the app runs. | xa11y `stableId`: the window handle, else the AutomationId |
| `platformRole` | `ax_role` | `atspi_role` | the UIA control type name of `control_type_id` |
| `scrollTypes` | `AXScrollArea` | `scroll pane` | none: the scroll actions of the element tell |
| `settleAfterReleaseMs` | 0 | 50: GTK 4 loses a click that comes in the same main-loop turn as the previous release | 0 |
| `typeTextMovesCaret` | yes | yes | no, so send keys is Raw input (xa11y gap 16) |
| `terminate` | `SIGTERM` to the process | `SIGTERM` to the process group (the app starts detached), else to the process | `TerminateProcess` (Node `process.kill`) |
| `startedAt` | `ps -o lstart` | `/proc/<pid>/stat` start ticks | `Win32_Process` creation time (CIM, through PowerShell) |

**GTK 4 on X11.** GTK 4 gives `(0, 0)` as the screen position of every element. Its window-relative extents are correct, but relative to the visible frame of the window, not to the X11 window. GTK 4 draws its shadow inside the X11 window and announces its size in `_GTK_FRAME_EXTENTS`, and the size changes when the window gains or loses focus. So the Linux adapter calculates: element = X11 window position + `_GTK_FRAME_EXTENTS` (left, top) + AT-SPI `GetExtents(WINDOW)`. It reads the extents through its own small AT-SPI and X11 clients (`platforms/linux/`), with no `xprop` or `xdotool`. It finds the X11 window by pid and title. When no window or more than one window matches, the element has no bounds. On Wayland there is no global position, so GTK 4 elements have no bounds. GTK 4.14 (Ubuntu 24.04) gives its windows the role `generic`, with no position and no activate action, so xa11y finds no window ([docs/xa11y-gaps.md](docs/xa11y-gaps.md)). The conformance suite, Docker and CI use Debian 13 (GTK 4.18). `src/platforms/linux/{atspi,dbus,x11,replies}.ts` exist only to correct GTK 4 bounds. Delete them when an xa11y release gives screen positions for GTK 4 elements that include `_GTK_FRAME_EXTENTS` (see [docs/xa11y-gaps.md](docs/xa11y-gaps.md), Linux item 1).

## Tests

- **Conformance suite** (`test/conformance/`): one WebDriver test set, run against the fixture apps of the OS it runs on. It is the definition of "this OS is supported" and of the Page source contract. It talks to a running Appium by URL, so the same suite runs on this Mac, on an instabox box through a tunnel, and in CI.
- **Fixture apps:** macOS: TextEdit, Calculator. Linux: `gtk3-widget-factory`, `gnome-calculator`, `mousepad`. Windows: Notepad, Calculator (`calc.exe` starts `win32calc.exe` on Windows Server).
- No mocks of xa11y or of the OS. A behaviour that cannot be tested on a real Desktop session is not tested.

## Hosts and Surfaces

One setup script per OS prepares a Host: [`hosts/`](hosts/). It installs Appium and the driver and runs Appium as a service **inside the Desktop session**, so it has the display, the session bus and the accessibility bus. On Linux it uses the Desktop session that exists; when there is none (CI, Docker, a bare server) it starts Xvfb, a D-Bus session and the AT-SPI bus.

| Surface | Host setup | Client connects |
|---|---|---|
| This machine | `hosts/<os>/setup.sh` | `http://127.0.0.1:4723` |
| Local VM, cloud machine | the same script in the VM | SSH tunnel to `127.0.0.1:4723` |
| instabox | `instabox create --setup-file hosts/linux/setup.sh`, or a box from a saved snapshot | `instabox port-forward <box> 4723` |
| Docker | `docker build -f docker/linux/Dockerfile -t appium-xa11y-linux .`: the image runs the Linux script | `docker run -p 127.0.0.1:4723:4723 appium-xa11y-linux`, then `http://127.0.0.1:4723` |
| CI | Linux: the script in a `debian:13` container. macOS: `xa11y/setup-a11y`, then the script. Windows: Appium from npm, and the driver from the checkout. | `127.0.0.1:4723` on the runner |
| Managed VM | the VM's own agent starts the same Appium and driver | its WebDriver hub |

**Where the Client runs.** Authoring (optics live, NL mode, MCP) runs on the user's machine through the tunnel. Jobs and CI run optics on the Host. On instabox the conformance suite took 77.0 s through the tunnel and 18.0 s on the Host.

## Adding an operating system

1. Write `src/platforms/<os>.ts` (or a `src/platforms/<os>/` folder) and register it in `src/platforms/index.ts`.
2. Add the OS's fixture apps to the conformance suite.
3. Write `hosts/<os>/setup.sh`.
4. In optics, add a `PlatformProfile` for it (data only).
5. Add a CI matrix row.

The OS is supported when the conformance suite passes on a real Host.

## optics

optics uses its existing Appium driver. Desktop support there is data and one rule: `PlatformProfile`s for `mac`, `windows` and `linux` (keys as Chords, wheel scroll, no phone-only calls), and an `@id` rung in the self-heal ladder for the Stable id. The optics MCP needs no new tools.
