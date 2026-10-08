# Contributing to Keystone

Thanks for helping. Keystone is a small project that protects people's passwords, so the rule of thumb is *small, careful and well tested*.

## Reporting a bug

Open an issue with the **Bug report** template. Please include:

- your Windows version and the Keystone version (**Settings** shows it, or the installer file name),
- what you did, what you expected, what happened,
- whether the database is on a USB drive or a normal folder, and which format it came from (KeePass version) if you know.

**Never attach real passwords, database files or key files**, and black out anything private in screenshots. If a database triggers the bug, make a small test database that reproduces it.

## Suggesting a feature

Open an issue and explain what you want to do and why. Small, focused ideas are the easiest to act on. Features that need the network are unlikely to be accepted (see the ground rules).

## Setting up

You need Windows 10/11 only. There is nothing to install; see **Build from source** in the [README](README.md).

```powershell
powershell -ExecutionPolicy Bypass -File windows\build-windows.ps1     # builds Keystone.exe
```

Edit files in `src/` (the interface) or `windows/Program.cs` (the Windows host) and rebuild. [docs/architecture.md](docs/architecture.md) explains how the pieces fit.

Useful while developing: set `KEYSTONE_TEST=1` to expose a `window.__ks` test hook, `KEYSTONE_DEBUG_PORT=9333` to allow DevTools protocol access, and `KEYSTONE_ALLOW_CAPTURE=1` to allow screenshots. None of these is on by default.

## Testing

Anything that touches the database format (`src/kdbx.js`, `src/vault.js`, `src/worker.js`) **must** be checked against the real KeePass library. Follow [tests/README.md](tests/README.md): it generates databases with KeePass, checks Keystone reads them identically, and lets you open Keystone's output back in KeePass. For interface or host changes, test by hand: open, create, edit, save, lock, and the USB scenarios if you touched detection.

## Pull requests

1. Fork the repository and branch from `main`.
2. Make one small, focused change.
3. Test it (see above) and say how in the description.
4. Open a pull request that explains what changed and why.

Keep the code style of the surrounding files. The project deliberately has no build tools or package dependencies; please do not add any without discussing it first.

## Ground rules

- **Keystone stays local.** Do not add network calls, analytics, telemetry or update checks without discussing it in an issue first. The page's Content-Security-Policy and the host both enforce this on purpose.
- **Never commit real credentials**, `.kdbx` databases, `.keyx`/`.key` files or personal data. The `.gitignore` blocks the usual file types; test databases must be generated, not committed.
- **Report security issues privately**, as described in [SECURITY.md](SECURITY.md).
- Be kind and respectful to everyone in the project.
