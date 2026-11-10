FROM debian:13
WORKDIR /opt/appium-xa11y-driver
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY src src
COPY test test
COPY scripts scripts
COPY hosts hosts
RUN hosts/linux/setup.sh --driver . --fixtures --no-service --address 0.0.0.0 && rm -rf /var/lib/apt/lists/*
EXPOSE 4723
CMD ["/root/.local/share/appium-xa11y/host.sh", "run"]
