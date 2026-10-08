# Tiny local web server for the compatibility harness (http://127.0.0.1:8787/t/core.html). Ctrl+C to stop.
param([int]$Port = 8787)
$tests = $PSScriptRoot; $root = Split-Path $tests -Parent
$map = @{ '/fx/' = "$tests\fixtures"; '/src/' = "$root\src"; '/t/' = "$tests\web"; '/out/' = "$tests\out" }
New-Item -ItemType Directory -Force "$tests\out" | Out-Null
$types = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.json' = 'application/json' }
$l = New-Object System.Net.HttpListener; $l.Prefixes.Add("http://127.0.0.1:$Port/"); $l.Start(); "serving on http://127.0.0.1:$Port/t/core.html"
while ($l.IsListening) {
  $ctx = $l.GetContext(); $req = $ctx.Request; $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ($req.HttpMethod -eq 'PUT' -and $path.StartsWith('/out/')) {            # the harness uploads files it writes so KeePass can check them
      $ms = New-Object IO.MemoryStream; $req.InputStream.CopyTo($ms)
      [IO.File]::WriteAllBytes((Join-Path $map['/out/'] ([IO.Path]::GetFileName($path))), $ms.ToArray()); $res.StatusCode = 204
    } else {
      $file = $null
      foreach ($k in $map.Keys) { if ($path.StartsWith($k)) { $cand = Join-Path $map[$k] $path.Substring($k.Length); if (Test-Path $cand -PathType Leaf) { $file = $cand } } }
      if ($file) { $b = [IO.File]::ReadAllBytes($file); $e = [IO.Path]::GetExtension($file).ToLower(); $res.ContentType = if ($types.ContainsKey($e)) { $types[$e] } else { 'application/octet-stream' }; $res.OutputStream.Write($b, 0, $b.Length) }
      else { $res.StatusCode = 404 }
    }
  } catch { $res.StatusCode = 500 }
  $res.Close()
}