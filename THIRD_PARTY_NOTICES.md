# Third-party notices

Keystone is MIT-licensed (see [LICENSE](LICENSE)). It includes, and is built with, the following third-party components.

## Microsoft Edge WebView2 SDK

- Files: `windows/lib/Microsoft.Web.WebView2.Core.dll`, `windows/lib/Microsoft.Web.WebView2.WinForms.dll`, `windows/lib/WebView2Loader.{x64,x86,arm64}.dll`
- Package: `Microsoft.Web.WebView2` 1.0.4258.31 from nuget.org
- Use: shows the interface inside the Keystone window. These files are embedded in `Keystone.exe`.
- License: BSD 3-clause style, reproduced in full below (also kept next to the files as `windows/lib/WebView2-LICENSE.txt` and `windows/lib/WebView2-NOTICE.txt`).

At run time Keystone also uses the **Microsoft Edge WebView2 Runtime** installed on the computer. It is a Microsoft product, is not part of this repository, and is updated by Microsoft.

## Inter typeface

- File: `src/fonts/InterVariable.woff2` (Inter 4.1 by Rasmus Andersson, https://github.com/rsms/inter), embedded in the interface
- License: SIL Open Font License 1.1, reproduced below (also `src/fonts/Inter-OFL.txt`).

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

### Inter license text

    Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter)
    
    This Font Software is licensed under the SIL Open Font License, Version 1.1.
    This license is copied below, and is also available with a FAQ at:
    http://scripts.sil.org/OFL
    
    -----------------------------------------------------------
    SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
    -----------------------------------------------------------
    
    PREAMBLE
    The goals of the Open Font License (OFL) are to stimulate worldwide
    development of collaborative font projects, to support the font creation
    efforts of academic and linguistic communities, and to provide a free and
    open framework in which fonts may be shared and improved in partnership
    with others.
    
    The OFL allows the licensed fonts to be used, studied, modified and
    redistributed freely as long as they are not sold by themselves. The
    fonts, including any derivative works, can be bundled, embedded,
    redistributed and/or sold with any software provided that any reserved
    names are not used by derivative works. The fonts and derivatives,
    however, cannot be released under any other type of license. The
    requirement for fonts to remain under this license does not apply
    to any document created using the fonts or their derivatives.
    
    DEFINITIONS
    "Font Software" refers to the set of files released by the Copyright
    Holder(s) under this license and clearly marked as such. This may
    include source files, build scripts and documentation.
    
    "Reserved Font Name" refers to any names specified as such after the
    copyright statement(s).
    
    "Original Version" refers to the collection of Font Software components as
    distributed by the Copyright Holder(s).
    
    "Modified Version" refers to any derivative made by adding to, deleting,
    or substituting -- in part or in whole -- any of the components of the
    Original Version, by changing formats or by porting the Font Software to a
    new environment.
    
    "Author" refers to any designer, engineer, programmer, technical
    writer or other person who contributed to the Font Software.
    
    PERMISSION AND CONDITIONS
    Permission is hereby granted, free of charge, to any person obtaining
    a copy of the Font Software, to use, study, copy, merge, embed, modify,
    redistribute, and sell modified and unmodified copies of the Font
    Software, subject to the following conditions:
    
    1) Neither the Font Software nor any of its individual components,
    in Original or Modified Versions, may be sold by itself.
    
    2) Original or Modified Versions of the Font Software may be bundled,
    redistributed and/or sold with any software, provided that each copy
    contains the above copyright notice and this license. These can be
    included either as stand-alone text files, human-readable headers or
    in the appropriate machine-readable metadata fields within text or
    binary files as long as those fields can be easily viewed by the user.
    
    3) No Modified Version of the Font Software may use the Reserved Font
    Name(s) unless explicit written permission is granted by the corresponding
    Copyright Holder. This restriction only applies to the primary font name as
    presented to the users.
    
    4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
    Software shall not be used to promote, endorse or advertise any
    Modified Version, except to acknowledge the contribution(s) of the
    Copyright Holder(s) and the Author(s) or with their explicit written
    permission.
    
    5) The Font Software, modified or unmodified, in part or in whole,
    must be distributed entirely under this license, and must not be
    distributed under any other license. The requirement for fonts to
    remain under this license does not apply to any document created
    using the Font Software.
    
    TERMINATION
    This license becomes null and void if any of the above conditions are
    not met.
    
    DISCLAIMER
    THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
    EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
    OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
    COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
    INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
    DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
    FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
    OTHER DEALINGS IN THE FONT SOFTWARE.
