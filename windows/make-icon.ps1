# Draws the Keystone icon in the Apple style (continuous-corner squircle, vertical gradient, soft highlight,
# hairline edge, glyph with depth) and writes a multi-size .ico plus, optionally, a 1024 px PNG for the docs.
param([string]$Out = (Join-Path $PSScriptRoot 'Keystone.ico'), [string]$Png = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$D = 'System.Drawing.Drawing2D'
function PF([double]$x, [double]$y) { New-Object System.Drawing.PointF ([single]$x), ([single]$y) }
function Col([int]$a, [int]$r, [int]$g, [int]$b) { [System.Drawing.Color]::FromArgb($a, $r, $g, $b) }

function New-Squircle([double]$x, [double]$y, [double]$size, [double]$n = 5.0) {      # superellipse: smoother than a rounded rectangle
  $p = New-Object "$D.GraphicsPath"; $pts = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
  $a = $size / 2; $cx = $x + $a; $cy = $y + $a
  for ($i = 0; $i -lt 360; $i++) {
    $t = $i * [Math]::PI / 180; $c = [Math]::Cos($t); $s = [Math]::Sin($t)
    $pts.Add((PF ($cx + $a * [Math]::Sign($c) * [Math]::Pow([Math]::Abs($c), 2.0 / $n)) ($cy + $a * [Math]::Sign($s) * [Math]::Pow([Math]::Abs($s), 2.0 / $n))))
  }
  $p.AddPolygon($pts.ToArray()); return $p
}
function Glyph-Path([double]$k, [double]$ox, [double]$oy) {                           # the keystone wedge, in 32-unit design coordinates
  $p = New-Object "$D.GraphicsPath"
  $p.AddPolygon([System.Drawing.PointF[]]@((PF ($ox + 11 * $k) ($oy + 6 * $k)), (PF ($ox + 21 * $k) ($oy + 6 * $k)), (PF ($ox + 25 * $k) ($oy + 26 * $k)), (PF ($ox + 7 * $k) ($oy + 26 * $k))))
  return $p
}

$S = 1024
$bmp = New-Object System.Drawing.Bitmap $S, $S, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.Clear([System.Drawing.Color]::Transparent)

$m = 100; $inner = $S - 2 * $m; $shape = New-Squircle $m $m $inner
for ($i = 22; $i -ge 1; $i--) {                                                       # soft drop shadow: stacked translucent copies
  $sp = New-Squircle ($m - $i * 1.2) ($m - $i * 1.2 + 16) ($inner + $i * 2.4)
  $g.FillPath((New-Object System.Drawing.SolidBrush (Col 5 0 20 15)), $sp); $sp.Dispose()
}
$rect = New-Object System.Drawing.RectangleF ([single]$m), ([single]$m), ([single]$inner), ([single]$inner)
$body = New-Object "$D.LinearGradientBrush" $rect, (Col 255 58 201 175), (Col 255 13 94 78), 90.0
$g.FillPath($body, $shape)
$g.SetClip($shape)                                                                    # light from above
$hlRect = New-Object System.Drawing.RectangleF ([single]$m), ([single]$m), ([single]$inner), ([single]($inner * 0.62))
$hl = New-Object "$D.LinearGradientBrush" $hlRect, (Col 70 255 255 255), (Col 0 255 255 255), 90.0
$g.FillRectangle($hl, [single]$m, [single]$m, [single]$inner, [single]($inner * 0.58))
$g.ResetClip()
$edge = New-Object "$D.LinearGradientBrush" $rect, (Col 120 255 255 255), (Col 70 0 40 30), 90.0
$g.DrawPath((New-Object System.Drawing.Pen $edge, 4), $shape)                         # hairline edge

$k = 19.0; $ox = 512 - 16 * $k; $oy = 512 - 16 * $k - 6
for ($i = 5; $i -ge 1; $i--) {                                                        # shadow under the glyph
  $sg = Glyph-Path $k $ox ($oy + 14 + $i * 2)
  $pen = New-Object System.Drawing.Pen (Col 16 0 30 22), (30 + $i * 5); $pen.LineJoin = 'Round'
  $g.DrawPath($pen, $sg); $g.FillPath((New-Object System.Drawing.SolidBrush (Col 16 0 30 22)), $sg)
}
$gp = Glyph-Path $k $ox $oy
$gRect = New-Object System.Drawing.RectangleF 0, ([single]($oy + 6 * $k - 16)), 10, ([single](20 * $k + 32))   # covers the rounded-corner stroke too, so no bands
$gb = New-Object "$D.LinearGradientBrush" $gRect, (Col 255 255 255 255), (Col 255 205 240 230), 90.0
$gpen = New-Object System.Drawing.Pen $gb, 30; $gpen.LineJoin = 'Round'               # rounded corners
$g.DrawPath($gpen, $gp); $g.FillPath($gb, $gp)
$hb = New-Object System.Drawing.SolidBrush (Col 255 20 112 94)                         # keyhole, with a little inner shadow
$cxh = $ox + 16 * $k; $cyh = $oy + 14.2 * $k; $r = 2.9 * $k
$g.FillEllipse((New-Object System.Drawing.SolidBrush (Col 90 0 40 30)), [single]($cxh - $r), [single]($cyh - $r - 4), [single](2 * $r), [single](2 * $r))
$g.FillEllipse($hb, [single]($cxh - $r), [single]($cyh - $r), [single](2 * $r), [single](2 * $r))
$g.FillPolygon($hb, [System.Drawing.PointF[]]@((PF ($cxh - 1.5 * $k) ($cyh + 0.6 * $k)), (PF ($cxh + 1.5 * $k) ($cyh + 0.6 * $k)), (PF ($cxh + 2.3 * $k) ($cyh + 6.6 * $k)), (PF ($cxh - 2.3 * $k) ($cyh + 6.6 * $k))))
$g.Dispose()

if ($Png) { $bmp.Save($Png, [System.Drawing.Imaging.ImageFormat]::Png) }
function Scaled([int]$px) {
  $b = New-Object System.Drawing.Bitmap $px, $px, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gg = [System.Drawing.Graphics]::FromImage($b); $gg.InterpolationMode = 'HighQualityBicubic'; $gg.PixelOffsetMode = 'HighQuality'; $gg.SmoothingMode = 'HighQuality'; $gg.CompositingQuality = 'HighQuality'
  $gg.DrawImage($bmp, 0, 0, $px, $px); $gg.Dispose()
  $ms = New-Object System.IO.MemoryStream; $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); return , $ms.ToArray()
}
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = @(); foreach ($s in $sizes) { $pngs += , (Scaled $s) }
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
$bw.Close(); $fs.Close(); $bmp.Dispose()
'Icon written: {0} ({1:N0} KB)' -f $Out, ((Get-Item $Out).Length / 1KB)
