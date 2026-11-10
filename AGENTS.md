# Agents

Read GLOSSARY.md and ARCHITECTURE.md before you change code.

## Rules

1. Write docs in ASD-STE100 Simplified Technical English.
2. Test only through WebDriver in `test/conformance/`. Write no unit tests and no mocks of xa11y or the OS.
3. Branch on the OS only in `src/platforms/`.
4. Throw `notSupportedYet('<os>', '<call>')` for a call that is not proven on an OS. Never use the behaviour of a different OS.
5. The Page source attributes are a contract. A change to them is a breaking change and needs a CHANGELOG.md entry.
6. Write no code comments, except a one-line reason that the code cannot show.

## Commands

Build:

```bash
npm run build
```

Typecheck:

```bash
npm run typecheck
```

Conformance, with Appium running on the Host (see CONTRIBUTING.md for the first run):

```bash
npm run conformance -- --url http://127.0.0.1:4723 --os linux
```

Use `--os mac` or `--os windows` for the other Hosts.
