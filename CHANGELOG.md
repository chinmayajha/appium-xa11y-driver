# Changelog

All notable changes to this project are in this file. The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1]

### Added

- `hosts/windows/setup.ps1` prepares a Windows Host.
- `appium:failureArtifacts`: a folder on the Host. When a command fails, the driver saves the Page source and a screenshot there. The folder keeps the 50 newest failures.

### Changed

- Windows is supported: the conformance suite passes on Windows Server 2022 and on the GitHub `windows-latest` runner.
- **Breaking:** In the Page source, an element with the role `web_area` and the `set_value` action has `editable="true"`. Before, it had `editable="false"`. Windows Notepad shows its text area with this role.
- The text of an editable element is its value only. An empty field gives an empty text, not its name.
- A session that uses `appium:appName` brings the app to the front.
- On Windows, send keys is Raw input. The driver focuses the element first, and this brings its window to the front.
- Send keys with the W3C NULL key (U+E000) is an `invalid argument` error.
- A W3C pointer button above 2 is an `unsupported operation` error. Before, it was a left click.
- On macOS, a key that stays held 1 s after its release makes the command fail. Before, the command passed.
- A run of `setup.sh` again keeps the `--driver`, `--address`, `--port` and Linux display options of the last run, unless a flag changes them. A driver spec with a version or a tag, for example `appium-xa11y-driver@0.1.0`, is a pin, and `setup.sh` does not update it.
- `setup.sh` refuses Node.js 23, because Appium 3 does not accept it.

### Fixed

- A W3C `pointerMove` moves the pointer along its line over its `duration`: each event goes to the point for the time since the move started. A move with a button down has 5 events or more, so on a slow platform it can take longer than its `duration`. A move ignores `duration` and jumps when the driver does not know where the OS pointer is: the first move of a session, and a move after a wheel action or after an element click that the driver sends as Raw input. Before, the pointer jumped to the end point, and some apps did not see a drag.
- Two W3C click pairs at one place, with nothing between them, are one double-click. Before, they were two single clicks, which macOS does not take as a double-click.
- An unknown W3C action type is an `invalid argument` error, and `pointerCancel` is an `unsupported operation` error. Before, the driver ignored them.
- On macOS, a W3C `pointerDown` with no `pointerUp` right after it presses at the pointer, and a move while it is down is a drag. Before, it pressed at `(0, 0)`, on the Apple menu.
- On Linux, a session starts when `appium:app` is a wrapper that starts the app as a child, an app that detaches itself, or a single-instance app that already runs. For a single-instance app, the driver stops the running instance and starts the app again, so work that is not saved in that instance is lost. Before, the session failed after `appium:launchTimeout`.
- On Windows, when `appium:app` is a launcher that exits, for example `calc.exe`, the session attaches to the app that the launcher started.
- On Linux, a session with no `appium:app` and no `appium:appName` attaches to the app with the active window. Before, it attached to the window manager.
- On macOS, the driver finds the running copies of an app by its bundle id, so a different process that has the executable name in its arguments does not match. A bundle id starts the installed copy of the app before a copy in a build folder.
- `terminateApp` and the session end stop only a process that the session started and that still runs. An app that stopped gives `false`, and the driver does not send a signal to a new process with the same pid.
- When `performActions` fails, the driver releases the keys and buttons that it holds. When a release fails, the driver tries it again at the next release.
- A key or button release does not need the Session app in front, so a `performActions` call that only releases runs when a different app is in front.
- In W3C actions with more than one input source, each source stays on its own ticks. Before, a press and release pair moved its source one tick ahead of the other sources.
- A W3C action `duration` that is not a finite number of 0 or more is an `invalid argument` error.
- The W3C keys `;`, `=` and the numpad keys type their characters. A different W3C key code with no desktop key is an `invalid argument` error.
- A wheel action outside the Desktop is a `move target out of bounds` error. On macOS, a wheel action at a negative coordinate, for example on a display at the left of the main display, works.
- On macOS, Ctrl, Fn and NumericPad do not stay on after a key press. Before, later keys typed as chords.
- A find from an element searches only below that element and does not return the element itself.
- The `accessibility id` strategy matches `@id` first, and `@name` only when no element has that id, as the README says.
- An XPath that selects attributes or values is an `invalid selector` error at once. Before, it was a `no such element` error after the implicit wait.
- The Page source does not fail when an element goes out of the tree during the walk.
- An element screenshot that is partly off the Desktop has the size of its visible part. Before, the image was stretched.
- On Linux, `POST /window/rect` sets the window rect that `GET /window/rect` gives for a GTK 4 window.
- On Linux, the driver uses the X11 cookie that libXau uses. A failed X11 or D-Bus connection gives an error and does not leave a socket open.
- On Linux, `setup.sh` records a live desktop display, so a start after a reboot waits for that display and does not start Xvfb. It turns on linger before it checks the systemd user manager, and it tells you when it installs no service.
- On macOS, `setup.sh` fails when Appium does not answer. The Linux and macOS scripts wait for an Appium status, not for any server on the port.
- `setup.sh --driver <path>` saves a relative path as an absolute path in `host.env`.

## [0.1.0]

- First release: macOS and Linux (X11); Windows experimental.
