# Desktop automation

This driver lets WebDriver clients, such as optics, operate native desktop apps on macOS, Windows and Linux through the operating system's accessibility tree.

## Places

**Host**:
The machine where the app under test, Appium and this driver run, inside a logged-in desktop session.
_Avoid_: device, target machine, server

**Client**:
The machine where the WebDriver client (optics, a test runner, an MCP server) runs. It can be the Host.
_Avoid_: controller, executor machine

**Surface**:
One kind of Host: the user's own machine, a local VM, a cloud machine (for example an instabox box), or a managed VM.
_Avoid_: environment, target

**Desktop session**:
The logged-in graphical session on the Host that owns the display, the session bus and the accessibility bus.
_Avoid_: GUI, screen session

## The app

**Session app**:
The one app that a WebDriver session operates. Every find, page source and input applies to it.
_Avoid_: target app, AUT, current app

**Frontmost app**:
The app that owns the active window of the Desktop session, so it receives raw input.
_Avoid_: foreground app, focused app

## The tree

**Page source**:
The XML form of the Session app's accessibility tree that this driver serves. Its tags and attributes are a contract with clients.
_Avoid_: DOM, hierarchy, dump

**Stable id**:
The id an app gives an element that does not change between runs (AutomationId on Windows, AXIdentifier on macOS, the accessible id on Linux). It is the `id` attribute.
_Avoid_: resource-id, accessibility id

**Desktop coordinates**:
The one coordinate space for bounds, pointer input and screenshots: logical points of the Desktop session, with the origin at the top left of the primary display.
_Avoid_: screen pixels, device pixels

## Input

**Accessibility action**:
An operation that the accessibility API performs on one element (press, set value, toggle, focus). It does not depend on which app is frontmost.
_Avoid_: semantic action

**Raw input**:
Synthetic keyboard, pointer or wheel events. They go to the Frontmost app.
_Avoid_: native input, OS events

**Frontmost guard**:
The rule that Raw input is sent only while the Session app is the Frontmost app.
_Avoid_: focus check

**Chord**:
Keys pressed together, written as `primary+s`, where `primary` is Cmd on macOS and Ctrl elsewhere.
_Avoid_: shortcut, hotkey
