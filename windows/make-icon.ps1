# Draws the Keystone icon (teal rounded square, white keystone with a keyhole) and writes a multi-size .ico.
param([string]$Out = (Join-Path $PSScriptRoot 'Keystone.ico'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Draw-Icon([int]$size) {
  $k = $size / 32.0
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
  $teal = [System.Drawing.Color]::FromArgb(26, 106, 88)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = 9 * $k
  $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($size - $r, 0, $r, $r, 270, 90)
  $path.AddArc($size - $r, $size - $r, $r, $r, 0, 90); $path.AddArc(0, $size - $r, $r, $r, 90, 90); $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush $teal), $path)
  $pt = { param($x, $y) New-Object System.Drawing.PointF ([single]($x * $k)), ([single]($y * $k)) }
  $g.FillPolygon([System.Drawing.Brushes]::White, [System.Drawing.PointF[]]@((& $pt 11 6), (& $pt 21 6), (& $pt 25 26), (& $pt 7 26)))
  $tb = New-Object System.Drawing.SolidBrush $teal
  $g.FillEllipse($tb, [single](13.4 * $k), [single](11.4 * $k), [single](5.2 * $k), [single](5.2 * $k))
  $g.FillPolygon($tb, [System.Drawing.PointF[]]@((& $pt 14.7 16.4), (& $pt 17.3 16.4), (& $pt 18.1 22.6), (& $pt 13.9 22.6)))
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  return , $ms.ToArray()
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = @(); foreach ($s in $sizes) { $pngs += , (Draw-Icon $s) }
$fs = [System.IO.File]::Create($Out); $bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $d = $sizes[$i]; $wh = if ($d -ge 256) { 0 } else { $d }
  $bw.Write([byte]$wh); $bw.Write([byte]$wh); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$pngs[$i].Length); $bw.Write([uint32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Close(); $fs.Close()
'Icon written: {0} ({1:N0} KB)' -f $Out, ((Get-Item $Out).Length / 1KB)
