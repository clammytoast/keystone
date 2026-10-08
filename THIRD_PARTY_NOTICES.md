# Third-party notices

Keystone is MIT-licensed (see [LICENSE](LICENSE)). It includes, and is built with, the following third-party components.

## Microsoft Edge WebView2 SDK

- Files: `windows/lib/Microsoft.Web.WebView2.Core.dll`, `windows/lib/Microsoft.Web.WebView2.WinForms.dll`, `windows/lib/WebView2Loader.{x64,x86,arm64}.dll`
- Package: `Microsoft.Web.WebView2` 1.0.4258.31 from nuget.org
- Use: shows the interface inside the Keystone window. These files are embedded in `Keystone.exe`.
- License: BSD 3-clause style, reproduced in full below (also kept next to the files as `windows/lib/WebView2-LICENSE.txt` and `windows/lib/WebView2-NOTICE.txt`).

At run time Keystone also uses the **Microsoft Edge WebView2 Runtime** installed on the computer. It is a Microsoft product, is not part of this repository, and is updated by Microsoft.

## Algorithms

The implementations of Argon2 (RFC 9106), BLAKE2b (RFC 7693), ChaCha20 (RFC 8439), Salsa20 and AES in this repository were written for Keystone and follow the published specifications; no third-party source code was copied.

## KeePass

Keystone reads and writes the KDBX file format documented and implemented by the [KeePass](https://keepass.info/) project. Keystone contains no KeePass source code and is not affiliated with or endorsed by KeePass. The tests in `tests/` load the `KeePass.exe` assembly that **you** supply from your own KeePass installation; it is not distributed here.

---

### WebView2 SDK license text

    Copyright (C) Microsoft Corporation. All rights reserved.
    
    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are
    met:
    
       * Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.
       * Redistributions in binary form must reproduce the above
    copyright notice, this list of conditions and the following disclaimer
    in the documentation and/or other materials provided with the
    distribution.
       * The name of Microsoft Corporation, or the names of its contributors
    may not be used to endorse or promote products derived from this
    software without specific prior written permission.
    
    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
    "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
    LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
    A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
    OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
    SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
    LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
    DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
    (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
    OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
