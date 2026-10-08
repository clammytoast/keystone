# Architecture

Keystone is two small programs that talk through a message bridge:

```
┌──────────────────────────── Keystone.exe ────────────────────────────┐
│  Windows host (windows/Program.cs)        Interface (src/ → Keystone.html) │
│  window, file dialogs, clipboard,   ◄──►  KDBX reader/writer, vault model, │
│  USB detection, lock events               screens. Runs inside WebView2.   │
└───────────────────────────────────────────────────────────────────────┘
```

The interface is plain HTML, CSS and JavaScript with no frameworks or packages. It is assembled into one file by `build.ps1`; the host embeds that file and serves it to the WebView2 control as `https://keystone.app/index.html`. Nothing is ever fetched from the network, and the page's Content-Security-Policy would block it if it tried.

## The interface (`src/`)

Files are concatenated in this order (see `build.ps1`) into a single script scope:

| File | Role |
|---|---|
| `kdbx.js` | The KDBX container: header parsing, key derivation dispatch, decryption and encryption for versions 3 and 4, HMAC block stream, inner-stream protection, key files, `create`, `rekey`, `verify`. |
| `worker.js` | Runs the slow part off the UI thread, in a Web Worker: AES-KDF and Argon2d/Argon2id (with BLAKE2b). |
| `util.js` | Password generator, strength estimate, TOTP. |
| `vault.js` | The unlocked database as groups and entries, and every edit (history, Recycle Bin, attachments, tags, moving, deletion records). The XML document stays the source of truth, so fields Keystone does not understand survive a save. |
| `app1.js` | UI toolkit: DOM helper, icons, settings, dialogs, menus, toasts. |
| `io.js` | **All contact with the outside world.** One native backend (talks to the host over the bridge) and one browser backend (File System Access API), so the interface can also run in a plain browser for testing. |
| `app2.js` | First screen, discovery of databases, unlocking, saving, backups, locking. |
| `app3.js` | The vault screens: sidebar, list, detail view. |
| `create.js` | Creating a new database. |
| `app4.js` | Editor, generator, settings, shortcuts, auto-lock, start-up. |

A KDBX file is read like this: parse the header → combine password and key file into a composite key → derive the transformed key (worker) → verify the header HMAC (a wrong key fails here) → decrypt and decompress → parse the XML → undo the inner-stream protection on password fields. Saving does the reverse with fresh random seeds, and the result is decrypted again and compared with memory before anything is written.

## The Windows host (`windows/`)

`Program.cs` is a WinForms window containing a WebView2 control. It embeds the interface and WebView2's managed and native libraries as resources (the native loader is unpacked to `%LOCALAPPDATA%\Keystone\bin` and checked by hash on every start). It implements the bridge commands in [host-bridge.md](host-bridge.md), plus the window-level behaviour: single instance, remembered window position, close handshake (so unsaved changes are never lost), lock when Windows locks, USB arrival/removal events, screenshot protection and the title bar theme.

`installer/Setup.cs` is the installer and uninstaller in one executable (per-user install, shortcuts, uninstall entry, optional "Open with" registration).

## Finding databases on USB drives

The host lists non-system drives; for removable drives it looks at the root and one folder level down for `.kdbx` files (ignoring Keystone's own backups) and picks the key file that sits next to each. The remembered database is stored with the drive's **volume serial number** and its path relative to the drive root, so it is found again on whatever letter Windows assigns, and a different drive that merely has a file of the same name is not mistaken for it.

## Environment variables for development

| Variable | Effect |
|---|---|
| `KEYSTONE_TEST=1` | Exposes `window.__ks` (internals) for tests. |
| `KEYSTONE_DEBUG_PORT=9333` | Enables DevTools and remote debugging on that port. |
| `KEYSTONE_ALLOW_CAPTURE=1` | Allows screenshots even when "hide from screenshots" is on. |
| `KEYSTONE_FAKE_DRIVES="SERIAL|Label|C:\folder;…"` | Treats folders as USB drives, for testing detection without hardware. |

None of these is set in normal use.
