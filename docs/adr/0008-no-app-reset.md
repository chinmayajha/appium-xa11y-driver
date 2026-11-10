# No app reset

A phone driver can reset an app: it stops the app, deletes the app data and starts the app again. This driver has no reset. It has no `noReset` or `fullReset` capability and no `xa11y:` method that deletes app state.

On a desktop, the state of an app is in many places: preferences, containers, saved window state, caches and files that the user opened. The places are different for each app and each OS, and a person can use the same account on the Host. A reset that deletes the wrong folder deletes the data of that person, and the driver cannot know which folders are safe to delete.

To start an app from a known state, reimage the Host (a VM or a container), or let the test delete the files of its own app before the session starts. `terminateApp` and `activateApp` stop and start the app, and do not change its state.
