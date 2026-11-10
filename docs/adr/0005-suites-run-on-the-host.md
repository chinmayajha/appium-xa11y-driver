# Jobs run the Client on the Host; authoring goes through a tunnel

Each WebDriver command through an SSH tunnel to a remote Host costs one round trip (about 320 ms to an instabox box in the measurements), and one optics step makes several. The same Calculator suite took 18.1 s through the tunnel and 6.7 s with optics on the Host. Interactive work (optics live, NL mode, MCP) accepts the delay and runs on the user's machine. Jobs and CI run optics on the Host, next to Appium.
