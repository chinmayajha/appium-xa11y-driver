# xa11y gaps

These are the limits of xa11y that the driver found, with xa11y 0.15.4 (the newest release on npm). Each item has a short repro that you can give to xa11y, and its status on xa11y `main` at 7820c4a. The repros use only built-in apps. In the repros, `xa11y` is `require('@crowecawcaw/xa11y')`.

The driver has a workaround for each item. The section [Not xa11y](#not-xa11y) lists the problems that come from other parts.

## Linux

### 1. GTK 4 bounds: the upstream fix does not add the window shadow

**Status on `main`:** open. Fix: [xa11y #677](https://github.com/xa11y/xa11y/pull/677). On Xfce, the focused and the unfocused window gave the same `_GTK_FRAME_EXTENTS`.

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

**Status on `main`:** by design (the docs say: the D-Bus object path). `AccessibleId` is empty in GTK 3 and GTK 4. Question: [xa11y #684](https://github.com/xa11y/xa11y/issues/684).

```js
const app = await xa11y.App.byName('gnome-calculator');
console.log((await app.locator('button[name="7"]').element()).stableId);
```

Seen: `/org/a11y/atspi/accessible/35` or `/org/gnome/Calculator/a11y/<uuid>`. The value changes each time the app starts. Expected: no `stableId`, or a value that stays the same, for example the accessible id that GTK 4 sets with `gtk_accessible_update_property`.

### 3. `App.foreground()` names the window manager on X11

**Status on `main`:** open. Fix: [xa11y #680](https://github.com/xa11y/xa11y/pull/680).

```js
console.log((await xa11y.App.foreground()).name);
```

Repro on Xfce with mousepad in front: seen `xfwm4`. Expected: `mousepad`. `window.active` is correct: it agrees with `_NET_ACTIVE_WINDOW`. The driver uses `window.active`.

### 4. The screenshot keeps the screen size of the first capture

**Status on `main`:** open. On `main`, a smaller screen gives an X11 `GetImage` error. Fix: [xa11y #679](https://github.com/xa11y/xa11y/pull/679).

```js
await xa11y.screenshot();                  // 1440 x 900
// in a shell: xrandr -s 1680x1050
const s = await xa11y.screenshot();         // still 1440 x 900: the top-left part of the screen
```

Expected: the new screen size after a RandR change. Workaround: restart the process.

### 5. `typeText` rejects newline and tab

**Status on `main`:** newline is fixed (xa11y #498). Tab still fails. Fix: [xa11y #678](https://github.com/xa11y/xa11y/pull/678).

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

**Status on `main`:** open, root cause not known. 3 of 100 to 12 of 200 chords fail. A 100 ms wait gives 0 of 100. Issue: [xa11y #681](https://github.com/xa11y/xa11y/issues/681).

After `input.chord('u', ['Meta'])`, the next `input.press('i')` sometimes arrives with Cmd. The driver sends the key-up events itself and waits until the event source shows no modifiers.

### 12. `typeText` in one call loses keys in Calculator

**Status on `main`:** open. The cause is 20 characters in one key event, not the pace. Fix: [xa11y #676](https://github.com/xa11y/xa11y/pull/676).

`input.typeText('7*6=')` gives only "7". Keys sent one at a time, 150 ms apart, give "42". xa11y does not pace the keys.

### 13. A second process cannot take a screenshot

**Status on `main`:** open. The two ScreenCaptureKit waits have no timeout. Issue: [xa11y #682](https://github.com/xa11y/xa11y/issues/682).

If one process holds a ScreenCaptureKit capture, `screenshot()` in a second process from the same responsible app waits and does not return. For this reason, all tests talk to one Appium process over WebDriver.

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
- **macOS screenshots:** two PNG captures of the same pixels can have different bytes. The wheel test reads the scroll bar value.
- **CI on macOS:** `xa11y/setup-a11y` grants only Accessibility. The workflows also add Screen Recording for the node binary to the TCC database. This is not tested on GitHub yet.
