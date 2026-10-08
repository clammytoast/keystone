# Host bridge

Keystone's interface (`src/`) is plain web code. It never touches the operating system directly. Everything outside the page goes through one small message bridge, so the interface stays independent of the host that runs it. The host:

1. shows a window with a web view,
2. serves the single file `build/Keystone.html` as `https://keystone.app/index.html` (or any secure origin),
3. implements the commands below.

The Windows host is `windows/Program.cs` (C#, WinForms + WebView2).

## Transport

Page → host: `window.chrome.webview.postMessage({ id, cmd, ...args })` (WebView2).
Host → page: `{ id, ok: true, result }` or `{ id, ok: false, error, code }`, and unsolicited events `{ event, data }`.

`src/io.js` is the only place that uses it.

Binary data (database bytes) is exchanged as base64 strings.

## Commands (page → host)

| cmd | args | result |
|---|---|---|
| `ready` | | – (page finished booting; close handshake is active after this) |
| `launchArgs` | | `string[]` command-line arguments (a `.kdbx` path when a file was opened with the app) |
| `openDialog` | `kind: "db" \| "key"` | `{ path, name, size, mtime }` or `null` |
| `saveDialog` | `kind: "db" \| "key" \| "any"`, `suggestedName` | `{ path, name }` or `null` |
| `readFile` | `path` | `{ data (base64), size, mtime }` |
| `statFile` | `path` | `{ exists, size, mtime }` (`mtime` = ms since epoch, UTC) |
| `writeFile` | `path`, `data` (base64) | `{ size, mtime }` — must be **atomic** (temp file + replace) and verified by reading back |
| `scanDrives` | | `[{ dbPath, name, size, keyPath, keyName, keyRel, root, drive, label, serial, removable, rel }]` — `.kdbx` files on connected drives (USB sticks: root and one folder level down; other non-system drives: root and vault-looking folders), with the key file found next to each. Backups (`… (backup …).kdbx`) are skipped. |
| `volumeInfo` | `path` | `{ root, drive, label, serial, removable, system, rel }` — identity of the drive a path is on; `serial` is the volume serial number and `rel` the path below the drive root |
| `resolveRecent` | `dbPath`, `dbRel`, `vol`, `keyPath`, `keyRel`, `keyVol` | `{ found, dbPath, keyPath, size, drive, label, removable, system }` — the remembered database wherever its drive is plugged in now. The same path only counts if the drive serial still matches. |
| `findKey` | `path` | path of the key file that belongs next to that database, or `null` |
| `pruneBackups` | `dir`, `prefix`, `keep` | – deletes the oldest `*.kdbx` named `prefix*` beyond `keep` |
| `clipboardCopy` | `text`, `clearMs` | – copy; exclude from clipboard history / cloud sync where the OS allows; after `clearMs` clear **only if the clipboard still holds this text** |
| `clipboardClear` | | – same conditional clear, immediately |
| `openUrl` | `url` | – open in the default browser; allow only `http`, `https`, `mailto`, `ftp` |
| `theme` | `dark` | – match title bar / window background |
| `captureProtection` | `on` | – hide the window from screenshots and screen sharing if possible |
| `dirty` | `dirty` | – (informational) |
| `quit` | | – close the window now |
| `closeCancelled` | | – the user cancelled a close; stop waiting |
| `drop` | *(sent with `postMessageWithAdditionalObjects`)* | – host resolves the dropped files' real paths, then raises the `dropped` event |

Errors should carry `code`: `FileNotFound`, `Unauthorized`, `IO` or `Error`.

## Events (host → page)

| event | data | meaning |
|---|---|---|
| `dropped` | `[{ path, name, size, mtime }]` | files dropped on the window |
| `sessionLock` | – | the OS session was locked: Keystone locks (saving first if it can) |
| `drivesChanged` | – | a drive was plugged in or removed (host debounces; it may fire twice) |
| `openFile` | `{ path }` | a `.kdbx` was opened with the app (double-click / Open with) while it was already running |
| `closeRequested` | – | the user pressed the window's close button: the page offers to save, then calls `quit` or `closeCancelled` |

## Rules the host must keep

- Serve **only** the embedded page; answer everything else with 404. The page's CSP forbids network access, and the host must not weaken it.
- Block navigation away from the app origin; send new-window requests to `openUrl` logic.
- Deny all web-view permission requests and cancel downloads (files are saved through `saveDialog` + `writeFile`).
- Leave only Cut / Copy / Paste / Select all in the context menu.
- Disable dev tools, browser accelerator keys, autofill and password saving in release builds.
