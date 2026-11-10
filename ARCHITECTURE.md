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
| `Target` | `launch(app, args)`, `attach({ name, pid })`, `switchTo(...)`, `app`, `terminateLaunched()` | Process start per OS, attach by pid, the list of launched pids, the clean-up when a session fails to start |
| `Tree` | `source()`, `find(strategy, selector, context?)`, `element(handle)`, `rect(element)` | The Page source contract, XPath over the snapshot, element handles and staleness, bounds in Desktop coordinates (toolkit corrections, hidden-element sentinels) |
| `Input` | `click(element)`, `type(text, element?)`, `chord(keys)`, `perform(actions)`, `release()` | Accessibility action first, Raw input second; the Frontmost guard on every Raw input path; modifier release; wheel; key names |
| `Screen` | `capture()`, `capture(rect)` | Scaling to Desktop coordinates; element and region images cut from one full capture |
| `Platform` | `os`, `primaryModifier`, `permissionHint`, `launch`, `frontmostPid`, `activate`, `wheel`, `releaseKeys`, `elementRect` | Everything that differs per OS and xa11y does not cover |

Rules:
- **Raw input exists only inside `Input`.** No other module calls `inputSim()`. The Frontmost guard is private to `Input`, so no path can skip it.
- **Coordinates exist only as Desktop coordinates.** `Tree.rect`, pointer input and `Screen` use the same space. Conversion happens once, in `Tree` (bounds) and `Screen` (images).
- **The Page source is a contract.** Tags are xa11y roles. Attributes: `type`, `name`, `value`, `label`, `id`, `enabled`, `visible`, `focused`, `selected`, `checked`, `clickable`, `checkable`, `editable`, `scrollable`, `x`, `y`, `width`, `height`. An element with no reliable bounds has no `x`/`y`/`width`/`height` and `visible="false"`. Changes are breaking changes for clients.
- **`Platform` is the only place that branches on the OS.** No `process.platform` outside `platforms/`.

## Platform seam

The seam has real adapters for macOS and Linux and a Windows adapter that reports "not supported yet on win32: <call>" for anything not proven on Windows. An adapter never falls back to another OS's behaviour.

| Call | macOS | Linux (X11) | Windows |
|---|---|---|---|
| `launch` | `open -n -a`, then the newest pid of the bundle executable | spawn, detached | spawn, detached |
| `frontmostPid` | xa11y foreground app | `_NET_ACTIVE_WINDOW` → `_NET_WM_PID` | not yet |
| `activate` | xa11y window activate | `_NET_ACTIVE_WINDOW` client message | not yet |
| `wheel` | continuous pixel scroll events | xa11y wheel | not yet |
| `releaseKeys` | wait until the event source reports the modifiers up | xa11y key up | not yet |
| `elementRect` | xa11y bounds | xa11y bounds; GTK4 children made absolute; `INT_MIN` sentinels → none | xa11y bounds |

## Tests

- **Conformance suite** (`test/conformance/`): one WebDriver test set, run against the fixture apps of the OS it runs on. It is the definition of "this OS is supported" and of the Page source contract. It talks to a running Appium by URL, so the same suite runs on this Mac, on an instabox box through a tunnel, and in CI.
- **Fixture apps:** macOS: TextEdit, Calculator. Linux: `gtk3-widget-factory`, `gnome-calculator`, `mousepad`. Windows: Notepad, Calculator.
- No mocks of xa11y or of the OS. A behaviour that cannot be tested on a real Desktop session is not tested.

## Hosts and Surfaces

One setup script per OS prepares a Host: [`hosts/`](hosts/). It installs Appium and the driver and runs Appium as a service **inside the Desktop session**, so it has the display, the session bus and the accessibility bus. On Linux it uses the Desktop session that exists; when there is none (CI, Docker, a bare server) it starts Xvfb, a D-Bus session and the AT-SPI bus.

| Surface | Host setup | Client connects |
|---|---|---|
| This machine | `hosts/<os>/setup.sh` | `http://127.0.0.1:4723` |
| Local VM, cloud machine | the same script in the VM | SSH tunnel to `127.0.0.1:4723` |
| instabox | `instabox create --setup-file hosts/linux/setup.sh`, or a box from a saved snapshot | `instabox port-forward <box> 4723` |
| CI | `xa11y/setup-a11y`, then the script | `127.0.0.1:4723` on the runner |
| Managed VM | the VM's own agent starts the same Appium and driver | its WebDriver hub |

**Where the Client runs.** Authoring (optics live, NL mode, MCP) runs on the user's machine through the tunnel. Jobs and CI run optics on the Host. On instabox the same suite took 18.1 s through the tunnel and 6.7 s on the Host.

## Adding an operating system

1. Write `src/platforms/<os>.ts` and register it in `src/platforms/index.ts`.
2. Add the OS's fixture apps to the conformance suite.
3. Write `hosts/<os>/setup.sh`.
4. In optics, add a `PlatformProfile` for it (data only).
5. Add a CI matrix row.

The OS is supported when the conformance suite passes on a real Host.

## optics

optics uses its existing Appium driver. Desktop support there is data and one rule: `PlatformProfile`s for `mac`, `windows` and `linux` (keys as Chords, wheel scroll, no phone-only calls), and an `@id` rung in the self-heal ladder for the Stable id. The optics MCP needs no new tools.
