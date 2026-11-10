# One setup script per OS prepares every Host

Appium must run inside the Desktop session: a system service or a plain SSH shell has no display, session bus or accessibility bus, and the tree comes back empty. One idempotent script per OS installs Appium and the driver and starts Appium as a service of the Desktop session. Local VMs, cloud machines, instabox boxes, Docker images and CI runners all use the same script, so a fix to Host setup is made once.
