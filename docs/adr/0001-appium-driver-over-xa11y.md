# Desktop automation is an Appium driver over xa11y

Clients reach desktop apps through WebDriver, so they need a WebDriver server next to the app. We build an Appium 3 driver on xa11y's Node bindings instead of an in-process optics driver or a host agent's private input channel. One code path then serves every Surface, works with any WebDriver client and Appium Inspector, and stays open source.

## Considered options

- An optics driver that calls xa11y in process: no WebDriver, so it cannot run behind a hub or a tunnel, and it doubles the code paths.
- A host agent's own input channel: not open source, and it gives no accessibility tree.
- NovaWindows and mac2: one OS each, and mac2 needs Xcode. They stay comparison baselines.
