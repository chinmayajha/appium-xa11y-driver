# Contributing

Read [GLOSSARY.md](GLOSSARY.md) and [ARCHITECTURE.md](ARCHITECTURE.md) before you change code. The conformance suite is the only test. It talks WebDriver to a running Appium on a real Desktop session.

## First run on Linux

The Host must use X11. Debian 13 (GTK 4.18) is the tested system.

1. Clone the repository.

   ```bash
   git clone https://github.com/chinmayajha/appium-xa11y-driver.git && cd appium-xa11y-driver
   ```

2. Install the dependencies.

   ```bash
   npm ci
   ```

3. Install Appium, this checkout of the driver and the fixture apps.

   ```bash
   hosts/linux/setup.sh --driver . --fixtures --no-service
   ```

4. Start Appium in the Desktop session.

   ```bash
   ~/.local/share/appium-xa11y/host.sh run &
   ```

5. Run the conformance suite.

   ```bash
   npm run conformance -- --url http://127.0.0.1:4723 --os linux
   ```

## First run with Docker

The image contains Debian 13, Xvfb, Openbox, the AT-SPI bus, Appium, the driver and the fixture apps.

1. Clone the repository and install the dependencies, as in steps 1 and 2 above.
2. Build the image.

   ```bash
   docker build -f docker/linux/Dockerfile -t appium-xa11y-linux .
   ```

3. Start a container. Publish the port only on `127.0.0.1`.

   ```bash
   docker run -d --name xa11y -p 127.0.0.1:4723:4723 appium-xa11y-linux
   ```

4. Run the conformance suite from the checkout.

   ```bash
   npm run conformance -- --url http://127.0.0.1:4723 --os linux
   ```

## First run on macOS

1. Clone the repository and install the dependencies, as in steps 1 and 2 above.
2. Install Appium and this checkout of the driver.

   ```bash
   hosts/mac/setup.sh --driver .
   ```

3. Grant Accessibility and Screen & System Audio Recording to the binary that the script shows. Use System Settings > Privacy & Security.
4. Restart Appium.

   ```bash
   launchctl kickstart -k gui/$(id -u)/appium-xa11y
   ```

5. Run the conformance suite. Keep the screen unlocked until the suite ends.

   ```bash
   npm run conformance -- --url http://127.0.0.1:4723 --os mac
   ```

## After a change

1. Build the checkout. `--driver .` links Appium to the checkout, so you do not install the driver again.

   ```bash
   npm run build
   ```

2. Restart Appium. On Linux with the service:

   ```bash
   systemctl --user restart appium-xa11y
   ```

   On macOS:

   ```bash
   launchctl kickstart -k gui/$(id -u)/appium-xa11y
   ```

   With `--no-service`, stop the `host.sh run` process and start it again. With Docker, build the image again and start a new container.

3. Run the conformance suite again.

## Rules

- Write docs in ASD-STE100 Simplified Technical English.
- Test only through WebDriver in `test/conformance/`. Do not write unit tests or mocks of xa11y or of the OS.
- Branch on the OS only in `src/platforms/`.
- For a call that is not proven on an OS, throw `notSupportedYet('<os>', '<call>')`. Do not use the behaviour of a different OS.
- The Page source attributes are a contract. A change to them is a breaking change and needs a [CHANGELOG.md](CHANGELOG.md) entry.
- Each new WebDriver command or `xa11y:` method needs a conformance test in the same change.

See [SECURITY.md](SECURITY.md) before you open Appium to a network.
