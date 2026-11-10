# Security

## Threat model

Appium and this driver give full control of the Desktop session. A Client can start any program, read any window and send keys to any app. Appium has no authentication. Anyone who can connect to the port has this control.

- Bind Appium to `127.0.0.1`. This is the default of the setup scripts.
- To reach a remote Host, use an SSH tunnel or a port-forward command of your cloud tool. Do not open the port to a network.
- The Docker image listens on all interfaces inside the container. Publish its port only on the loopback address: `-p 127.0.0.1:4723:4723`.

## Report a vulnerability

Use GitHub private vulnerability reporting on this repository. Do not open a public issue for a vulnerability.

## Supported versions

Only the latest minor version gets security fixes.
