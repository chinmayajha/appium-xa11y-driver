FROM node:22-bookworm-slim AS node

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
# The [base] group of https://github.com/xa11y/setup-a11y/blob/main/apt-packages.txt, plus a GTK app to drive.
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb dbus dbus-x11 fluxbox at-spi2-core \
      libxkbcommon-dev libxkbcommon-x11-0 libxkbcommon-x11-dev \
      libxcursor1 libxrandr2 libxi6 \
      libx11-xcb1 libxcb-render0 libxcb-shape0 libxcb-xfixes0 \
      libegl1 libglib2.0-0 libfontconfig1 libdbus-1-3 \
      libxcb-cursor0 libxcb-icccm4 libxcb-keysyms1 \
      libxcb-image0 libxcb-render-util0 libxcb-xkb1 \
      ca-certificates gnome-text-editor \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
WORKDIR /opt/appium-xa11y-driver
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src src
COPY test test
RUN npm run build
COPY docker/linux/entrypoint.sh /usr/local/bin/entrypoint.sh
EXPOSE 4723
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npx", "appium", "--address", "0.0.0.0", "--port", "4723"]
