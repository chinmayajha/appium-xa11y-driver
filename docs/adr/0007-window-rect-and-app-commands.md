# Window rect and app commands

`GET /window/rect` gives the rect of the Desktop, not of a window. Screenshots and pointer actions then use one space, and a client can click at a pixel of a screenshot. `POST /window/rect` moves and resizes the main window of the Session app, and gives the new rect of that window.

An element with no reliable bounds gets the rect `{x: 0, y: 0, width: 0, height: 0}` from `GET /element/:id/rect`. The Page source does not show bounds for that element, and sets `visible="false"`. A client must check `displayed` before it uses a rect.

`activateApp(appId)` attaches to a running instance of the app first, and brings it to the front. It launches the app only when no instance runs. `terminateApp(appId)` stops only that app: the instances that the session started, and the instance that runs now. On Windows the driver cannot find a running instance or launch an app yet, so `activateApp` and `terminateApp` give `not yet implemented`.
