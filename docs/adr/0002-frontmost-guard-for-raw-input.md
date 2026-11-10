# Raw input is sent only while the Session app is frontmost

Raw input goes to whatever app is frontmost, and a system alert can take that place at any time. The driver uses Accessibility actions first and sends Raw input only after it checks that the Session app is frontmost, immediately before the events. If the check fails, the command fails with `invalid element state` and sends nothing. A failed test is better than keys typed into another app.
