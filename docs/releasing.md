# Releasing

## Steps

1. Update the version in `windows/installer/Setup.cs` (`Core.Version`), `windows/installer/build-installer.ps1` (`$version`), `windows/Program.cs` (assembly attributes) and the Settings text in `src/app4.js`, then add an entry to [CHANGELOG.md](../CHANGELOG.md).
2. Build:

   ```powershell
   powershell -ExecutionPolicy Bypass -File windows\build-windows.ps1
   powershell -ExecutionPolicy Bypass -File windows\installer\build-installer.ps1
   ```

3. Run the compatibility tests ([tests/README.md](../tests/README.md)) and try an install, an unlock, a save and an uninstall on a clean Windows user.
4. Compute the checksum:

   ```powershell
   (Get-FileHash dist\Keystone-Setup-1.0.0.exe -Algorithm SHA256).Hash.ToLower()
   ```

5. On GitHub: **Releases → Draft a new release**, create the tag `v1.0.0`, attach `Keystone-Setup-1.0.0.exe` and `Keystone-Setup-1.0.0.exe.sha256` (and optionally the portable `Keystone.exe`), and paste the notes below.
6. Download the installer back from the release and confirm its hash matches.

## Release notes template

```markdown
## Keystone 1.0.0

<what is new, from the changelog>

### Download
- **Keystone-Setup-1.0.0.exe** — installer (Windows 10/11, no administrator rights needed)

### Verify your download
SHA-256 of `Keystone-Setup-1.0.0.exe`:

    <paste the hash>

PowerShell: `(Get-FileHash .\Keystone-Setup-1.0.0.exe -Algorithm SHA256).Hash`

### Good to know
- Not code-signed yet: Windows SmartScreen may warn ("More info → Run anyway"), and Smart App Control may block it.
- Early release, not independently audited. See SECURITY.md.
```

## Code signing

Windows SmartScreen and Smart App Control judge unknown programs by their publisher signature and reputation. Until `Keystone.exe` and the installer are signed, some users will see warnings, and Smart App Control can block any particular unsigned build.

Signing needs a certificate issued by a certificate authority that Windows trusts (for example through Azure Trusted Signing, or a commercial code-signing certificate). A self-made certificate does not help. Signing is a separate step after the build, so nothing in the code changes:

```powershell
# with a certificate available to signtool.exe (Windows SDK)
signtool sign /fd SHA256 /tr <timestamp-server-url> /td SHA256 /a Keystone.exe
signtool sign /fd SHA256 /tr <timestamp-server-url> /td SHA256 /a dist\Keystone-Setup-1.0.0.exe
```

Sign `Keystone.exe` **before** building the installer (the installer embeds it), then sign the installer.
