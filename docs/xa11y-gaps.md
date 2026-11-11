# xa11y gaps

These are the limits of xa11y that the driver found, with xa11y 0.15.4 (the newest release on npm). Each item has a short repro that you can give to xa11y, and its status on xa11y `main` at 3fd18ef. The repros use only built-in apps. In the repros, `xa11y` is `require('@crowecawcaw/xa11y')`.

The driver has a workaround for each item. The section [Not xa11y](#not-xa11y) lists the problems that come from other parts.

## Linux

### 1. GTK 4 bounds: the upstream fix does not add the window shadow

**Status on `main`:** fixed ([xa11y #677](https://github.com/xa11y/xa11y/pull/677), merged, not released). On Xfce, the focused and the unfocused window gave the same `_GTK_FRAME_EXTENTS`.

xa11y #487 (closed, not released) adds the X11 position of the client window to the window-relative extents of GTK 4. But GTK 4 draws its shadow inside the X11 window, and the window-relative extents start at the visible frame. So the fix gives positions that are too far up and to the left, by the size of the shadow. The shadow size is in `_GTK_FRAME_EXTENTS`. It changes when the window gains or loses focus.

Repro on X11 (Xfce): start `gnome-calculator`, then move it with `xdotool search --name '^Calculator$' windowmove 100 60`.

| | Value |
|---|---|
| X11 window position | (100, 60) |
| `_GTK_FRAME_EXTENTS` (left, right, top, bottom) | 61, 61, 55, 67 |
| `GetExtents(WINDOW)` of the button "C" | (24, 380) |
| The #487 calculation, 100 + 24 and 60 + 380 | (124, 440) |
| With the shadow, 100 + 61 + 24 and 60 + 55 + 380 | (185, 495) |
| The button "C" in a screenshot | (173, 483) |

Expected: add `_GTK_FRAME_EXTENTS` left and top. The 12 px that remain for gnome-calculator come from GTK (see [Not xa11y](#not-xa11y)). In `gtk4-widget-factory` the calculation with the shadow is exact.

### 2. `stableId` is the AT-SPI object path

**Status on `main`:** by design (the docs say: the D-Bus object path). `AccessibleId` is empty in GTK 3 and GTK 4. [xa11y #693](https://github.com/xa11y/xa11y/pull/693) documents the `stableId` lifetimes and closes [xa11y #684](https://github.com/xa11y/xa11y/issues/684).

```js
const app = await xa11y.App.byName('gnome-calculator');
console.log((await app.locator('button[name="7"]').element()).stableId);
```

Seen: `/org/a11y/atspi/accessible/35` or `/org/gnome/Calculator/a11y/<uuid>`. The value changes each time the app starts. Expected: no `stableId`, or a value that stays the same, for example the accessible id that GTK 4 sets with `gtk_accessible_update_property`.

### 3. `App.foreground()` names the window manager on X11

**Status on `main`:** fixed ([xa11y #680](https://github.com/xa11y/xa11y/pull/680), merged, not released).

```js
console.log((await xa11y.App.foreground()).name);
```

Repro on Xfce with mousepad in front: seen `xfwm4`. Expected: `mousepad`. `window.active` is correct: it agrees with `_NET_ACTIVE_WINDOW`. The driver uses `window.active`.

### 4. The screenshot keeps the screen size of the first capture

**Status on `main`:** fixed ([xa11y #679](https://github.com/xa11y/xa11y/pull/679), merged, not released).

```js
await xa11y.screenshot();                  // 1440 x 900
// in a shell: xrandr -s 1680x1050
const s = await xa11y.screenshot();         // still 1440 x 900: the top-left part of the screen
```

Expected: the new screen size after a RandR change. Workaround: restart the process.

### 5. `typeText` rejects newline and tab

**Status on `main`:** fixed. Newline: xa11y #498. Tab: [xa11y #692](https://github.com/xa11y/xa11y/pull/692) (merged, not released), on all three platforms; it includes the Linux commit of #678.

```js
xa11y.inputSim().typeText('a\nb');
```

Seen: `ActionNotSupportedError: character '\n' (keysym 0x100000a) has no keycode`. Expected: the Return and Tab keys. xa11y #494 is related. The driver presses Enter and Tab for these characters.

### 6. The wheel is in clicks, not pixels

**Status on `main`:** by design (the unit is wheel ticks). The round trip in mousepad now comes back to 0. Question: [xa11y #683](https://github.com/xa11y/xa11y/issues/683).

`inputSim().scroll(at, dx, dy)` takes lines. A toolkit decides the size of one click, so 30 clicks moved GTK 3 about 80 lines. Also, 30 clicks down and 30 clicks up do not come back to the same place in mousepad (0 → 1700 → 176 px). The driver uses 20 px for one line, and the conformance suite checks only the direction.

### 7. GTK 4.14: windows have the role `generic`

**Status on `main`:** fixed (xa11y #485 and #600). With GTK 4.14.5 (Ubuntu 24.04), gnome-calculator has one window with bounds and an activate action.

```js
console.log((await (await xa11y.App.byName('gnome-text-editor')).windows()).length);
```

Seen on Ubuntu 24.04 (GTK 4.14): `0`. The same occurs with `gnome-calculator`: the children of the application are two `group` elements (AT-SPI `generic`) with `active` false and bounds at (0, 0), and `activate()` gives `activate not supported on group`. The button "7" also has its bounds at (0, 0). Expected: one window, with its X11 position and an activate action. xa11y #485 (closed, not released) is related. GTK 4.18 on Debian 13 gives the role `window`. For this reason, the Docker image and the Linux CI job use Debian 13.

### 15. xa11y does not reconnect after the AT-SPI bus restarts

**Status on `main`:** fixed (xa11y #546, not released). On `main`, the next call opens a new connection, and an app that starts after the restart is found in the same process.

Repro on Xfce (Debian 13), in one Node process: start mousepad, read its tree, then stop `at-spi-bus-launcher`, its `dbus-daemon` and `at-spi2-registryd`. Start a second mousepad, which starts the bus again.

| | 0.15.4 | `main` |
|---|---|---|
| `App.list()`, 3 calls after the restart | `GetChildren failed: I/O error: Broken pipe (os error 32)` each time | `[]` each time, no error |
| `App.byPid()` of the new mousepad | the same error | found, with one `window` child |

A new process works with 0.15.4 too. Workaround: restart the process.

### 21. Reads through the `App` of an exited process give a platform error

**Status on `main`:** fixed ([xa11y #691](https://github.com/xa11y/xa11y/pull/691), merged, not released). In 0.15.4, after the app process exits, `app.locator(...).count()` and `app.windows()` fail with `Platform: GetChildren failed: ... ServiceUnknown`, not `ElementStale` with `ProcessExited`. A caller cannot tell it from a broken bus. Seen on Debian 13 with a GTK 3 app that was killed.

### 24. A multi-click on X11 has no gap between the clicks

**Status on `main`:** open. Fix: [xa11y #697](https://github.com/xa11y/xa11y/pull/697). `click(count=2)` sends the two press/release pairs with no gap. GTK takes some of them as two single clicks: 5 of 60 in Mousepad (GTK 3) and 3 of 60 in a GTK 4 entry, on Debian 13 Xfce. `xdotool` with a 2 ms or 12 ms gap loses 0 of 60.

```js
await input.click([x, y], { count: 2 });
```

Expected: the word under the pointer is selected. The driver sends one click at a time, 50 ms apart.

## macOS

### 8. An app with no window is its own child

**Status on `main`:** not reproduced. The repro needs a locked screen.

```js
const app = await xa11y.App.byName('TextEdit');
const kids = await app.asElement().children();
console.log(kids.map((k) => k.role));
```

Seen when the screen is locked: `['application']`, and that child also has the application as its only child. A walk of the tree does not stop. Expected: no children. The driver skips an `application` below the root.

### 9. A drag releases too fast

**Status on `main`:** fixed (xa11y #515). 5 of 5 drags select the line.

`inputSim().drag(from, to)` across one line of text in TextEdit does not select it. Typing "D" after the drag gives "first line here\nsecond lineD". Expected: "D\nsecond line". xa11y #515 (closed, not released).

### 10. The menu bar is not in the app tree

**Status on `main`:** by design (xa11y #374).

`app.locator('menu_bar')` finds nothing. This is by design: `ShellSurface.byKind('menu_bar')` gives it (xa11y #374). The driver does not put it in the Page source yet.

### 11. A chord does not wait until the modifiers are up

**Status on `main`:** open, root cause not known. In TextEdit, 3 of 100 to 12 of 200 chords fail, and a 100 ms wait gives 0 of 100. In the xa11y Cocoa test app's `Search` field, 174 of 200 fail on `main` 0c769d5 (after xa11y #695), 188 of 200 with 0.15.4, and 1 of 50 with a 500 ms wait. Issue: [xa11y #681](https://github.com/xa11y/xa11y/issues/681).

After `input.chord('u', ['Meta'])`, the next `input.press('i')` sometimes arrives with Cmd. The driver sends the key-up events itself and waits until the event source shows no modifiers.

### 12. `typeText` in one call loses keys in Calculator

**Status on `main`:** fixed ([xa11y #676](https://github.com/xa11y/xa11y/pull/676), merged, not released). The cause was 20 characters in one key event, not the pace.

`input.typeText('7*6=')` gives only "7". Keys sent one at a time, 150 ms apart, give "42". xa11y does not pace the keys.

### 20. Keys after a function key get the Fn flag

**Status on `main`:** fixed ([xa11y #687](https://github.com/xa11y/xa11y/pull/687), merged, not released). #687 made a modifier key-up copy stale flags, so Ctrl stayed held after a Cmd+Ctrl chord; xa11y #695 fixed that. In 0.15.4, after `press("Home")` or `press("F5")`, the session state keeps Fn, and the next keys copy it: `typeText("ab")` arrived as nothing, 20 of 20 times. The driver clears the flags after each function key.

### 13. A second process cannot take a screenshot

**Status on `main`:** open. The two ScreenCaptureKit waits have no timeout. Issue: [xa11y #682](https://github.com/xa11y/xa11y/issues/682).

If one process holds a ScreenCaptureKit capture, `screenshot()` in a second process from the same responsible app waits and does not return. For this reason, all tests talk to one Appium process over WebDriver. The driver stops a capture wait after 10 s with an error, and on macOS a pointer action does not take a screenshot. The native wait still holds one Node.js worker thread, and the driver does not start a new capture while it waits, so the next screenshots fail at once. Stop the process that holds the capture. If screenshots still fail, restart Appium.

### 22. A held button is pressed at (0, 0) and moves as a plain move

**Status on `main`:** fixed ([xa11y #635](https://github.com/xa11y/xa11y/pull/635), merged, not released). In v0.15.4, `mouseDown` and `mouseUp` post the button event at `(0, 0)` (`git show v0.15.4:xa11y-macos/src/input.rs`, the `Point::new(0, 0)` lines), and `moveTo` always posts `kCGEventMouseMoved`.

```js
const input = xa11y.inputSim();
await input.moveTo([400, 300]);
await input.mouseDown('left');
```

The press lands on the Apple menu at the top-left corner, and the menu stays open. Expected: a press at `(400, 300)`. With a button held, `moveTo` must post the dragged event type, or the app sees no drag. The driver posts the press, the release and the move while a button is held with CoreGraphics at the pointer.

### 23. `activate` fails on a SwiftUI scene window

**Status on `main`:** open. Fix: [xa11y #696](https://github.com/xa11y/xa11y/pull/696). `activate` sets `AXFrontmost` on the app, then sends `AXRaise` to the window. A window from the SwiftUI scene lifecycle (`WindowGroup`, Calculator on macOS 26) advertises `AXRaise` but answers -25205, also when it is already the main window. With 0.15.4, `activate` on the Calculator window fails 20 of 20 times.

```js
const app = await xa11y.App.byName('Calculator');
await (await app.windows())[0].activate();
```

The driver accepts the error when the app is frontmost after the call.

## Windows

Seen on Windows Server 2022 (build 20348), in the console session. The status on `main` is not checked: `main` was not built on Windows.

### 16. Element `typeText` does not move the caret

**Status:** open. With 0.15.4, "ab" then "c" gives `cab` in Notepad 5 of 5 times, and `abc` in mousepad on Linux 5 of 5 times. `SetValue` leaves the caret at 0. Issue: [xa11y #689](https://github.com/xa11y/xa11y/issues/689).

```js
const app = await xa11y.App.byPid(notepadPid);
const edit = async () => (await (await app.windows())[0].children()).find((k) => k.role === 'web_area');
await (await edit()).typeText('ab');
await (await edit()).typeText('c');
console.log((await edit()).value);
```

Seen: `cab`, and the Notepad status bar stays at `Ln 1, Col 1`. Expected: `abc`, because the docs say "type at the current caret position". Raw input after the call also goes before the text. The driver types as Raw input on Windows.

### 17. The wheel scrolls up for a positive `dy`

**Status on `main`:** fixed ([xa11y #694](https://github.com/xa11y/xa11y/pull/694), merged, not released): a positive `dy` scrolls toward the end on every platform (from the PR; not tested here). With 0.15.4 and a 400-line file, `dy=+3` moves mousepad toward the end (0, 176, 352) and Notepad toward the top; `dy=-3` moves Notepad toward the end. The macOS code sends `dy` as Quartz `wheel1`, where positive is up. Issue: [xa11y #688](https://github.com/xa11y/xa11y/issues/688).

The docs say: "`dy` positive → content scrolls down". On Linux a positive `dy` scrolls the view down. On Windows, `inputSim().scroll(at, 0, 30)` over Notepad, at the end of 200 lines, moves the value of the vertical scroll bar from 100 to 46. The driver negates `dy` on Windows.

### 18. `stableId` is the window handle of a Win32 control

**Status on `main`:** fixed ([xa11y #693](https://github.com/xa11y/xa11y/pull/693), merged, not released): a control uses its AutomationId first (from the PR; not tested on Windows). In 0.15.4, Notepad's edit control gave `hwnd:0x2801d0`, then `hwnd:0x280196`, with AutomationId `15` both times. Added to the Linux question: [xa11y #684](https://github.com/xa11y/xa11y/issues/684#issuecomment-6777690477).

```js
const app = await xa11y.App.byName('win32calc');
const seven = await app.locator('button[name="7"]').element();
console.log(seven.stableId, seven.raw.automation_id);
```

Seen: `hwnd:0x4013c 137`. The handle changes each time the app starts, and the AutomationId stays the same. Expected: the AutomationId, as for elements with no handle (for example `TitleBar`). The driver uses `raw.automation_id` as the Stable id.

### 19. Notepad's text area has the role `web_area`

**Status:** open. The multi-line Win32 `Edit` has the UIA Document control type, and xa11y maps every Document to `web_area`. On macOS and Linux a plain text editor is `text_area`. Issue: [xa11y #690](https://github.com/xa11y/xa11y/issues/690). The driver marks a `web_area` with `set_value` as editable.

## Node bindings

### 14. Typed errors lose their error code

**Status on `main`:** stale elements are fixed: `XA11Y_ELEMENT_STALE` now gives `ElementStaleError`, a subclass of `SelectorNotMatchedError` (xa11y #661). The error code is fixed too ([xa11y #685](https://github.com/xa11y/xa11y/pull/685), merged, not released).

`toTypedError` in `index.js` makes the typed error from the `XA11Y_*` code, but it does not keep the code. Some codes share one class, so the caller can tell them apart only by the message text:

| Class | Codes |
|---|---|
| `SelectorNotMatchedError` | `XA11Y_SELECTOR_NOT_MATCHED`, `XA11Y_ELEMENT_STALE` (0.15.4) |
| `InvalidActionDataError` | `XA11Y_INVALID_ACTION_DATA`, `XA11Y_NO_ELEMENT_BOUNDS`, `XA11Y_INVALID_CONFIG` |
| `ActionNotSupportedError` | `XA11Y_ACTION_NOT_SUPPORTED`, `XA11Y_TEXT_VALUE_NOT_SUPPORTED`, `XA11Y_UNSUPPORTED` |

```js
// XA11Y_DEFAULT_TIMEOUT=bad
try { xa11y.getDefaultTimeout(); } catch (e) { console.log(e.name, e.code); }
```

Seen: `InvalidActionDataError undefined`. Expected: `InvalidActionDataError XA11Y_INVALID_CONFIG`. The driver reads `e.code` first when it exists.

## Not xa11y

- **GTK 4, gnome-calculator:** the `GetExtents(WINDOW)` positions of the buttons are 12 px right and 12 px down of the drawn buttons. In `gtk4-widget-factory` they are exact. A click at the centre of a rect still hits the button.
- **GTK 4:** AT-SPI `DoAction` replies before the app runs the action. If an Accessibility click and Raw input come one after the other, the Raw input can arrive first. Seen in gnome-calculator: an AT-SPI press of "+", then a pointer click on "5", gave "5+".
- **mousepad:** when the driver stops it with SIGTERM, the next start asks to restore the session. The Linux setup script with `--fixtures` sets `session-restore` to `never`.
- **Xvnc and Xfce:** a VNC viewer can change the screen size of the box. After `xrandr --fb`, Xfce does not draw the new area and the panel stays at the old place. Use a mode from the `xrandr` list with `xrandr -s`.
- **macOS, screen locked:** all app trees are empty and `loginwindow` has the only window. The suite cannot run until the screen is unlocked.
- **macOS privacy alerts:** a system alert, for example a request to access data from other apps, becomes the frontmost app. The Frontmost guard then refuses Raw input, as it must. Only the user can answer the alert.
- **macOS permissions:** the permissions go to the responsible app. A shell inside a different app (for example an IDE) can have no Accessibility while a terminal app has it.
- **Unnatural Scroll Wheels** inverts line wheel events. The driver sends pixel scroll events, which it does not change.
- **TextEdit:** the frame of the text area is the full height of the document. Clicks and element screenshots use the visible part.
- **macOS event-source flags:** after the first synthetic key event, `CGEventSourceFlagsState` gives `0x20000000` for both the combined session state and the HID state and keeps it, a bit that no documented mask has and that does not stop a key test.
- **macOS screenshots:** two PNG captures of the same pixels can have different bytes. The wheel test reads the scroll bar value.
- **Windows Server, `calc.exe`:** it starts `win32calc.exe` and exits at once. The app process is `win32calc`.
- **Notepad:** Enter gives `\r\n` in the text. The window title hides a known file extension, for example `system - Notepad` for `system.ini`.
- **Windows Server:** the xa11y binary needs the Microsoft Visual C++ 2015–2022 runtime. GitHub runners have it, so CI does not show this.
- **CI on macOS:** `xa11y/setup-a11y` grants only Accessibility. The workflows also add Screen Recording for the node binary to the TCC database. The macOS CI job runs this grant and passes on GitHub. `examples/optics-ci.yml` has not run yet.
