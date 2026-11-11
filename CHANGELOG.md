# Changelog

All notable changes to this project are in this file. The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `hosts/windows/setup.ps1` prepares a Windows Host.

### Changed

- Windows is supported: the conformance suite passes on Windows Server 2022 and on the GitHub `windows-latest` runner.
- The `appium:failureArtifacts` folder keeps the 50 newest failures. Before, it had no limit.

### Fixed

- A W3C `pointerMove` moves the pointer in steps over its `duration`, and a move with a button down has 5 steps or more. Before, the pointer jumped to the end point, and some apps did not see a drag.
- Two W3C click pairs at one place, with nothing between them, are one double-click. Before, they were two single clicks, which macOS does not take as a double-click.
- An unknown W3C action type is an `invalid argument` error, and `pointerCancel` is an `unsupported operation` error. Before, the driver ignored them.
- On macOS, a W3C `pointerDown` with no `pointerUp` right after it presses at the pointer, and a move while it is down is a drag. Before, it pressed at `(0, 0)`, on the Apple menu.
- On Linux, a session starts when `appium:app` is a wrapper that starts the app as a child, an app that detaches itself, or a single-instance app that already runs. For a single-instance app, the driver stops the running instance and starts the app again, so work that is not saved in that instance is lost. Before, the session failed after `appium:launchTimeout`.

## [0.1.0]

- First release: macOS and Linux (X11); Windows experimental.
