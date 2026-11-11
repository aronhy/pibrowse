# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright 2026 Bogdan Shapovalov and the Fury authors
#
# Put PiBrowse's icons into the Chromium tree for a Windows build.
#
#     powershell -ExecutionPolicy Bypass -File core\build\link-icons-windows.ps1
#
# link-icons.sh preserves Chromium's native/Dock base on macOS and replaces the
# internal PiBrowse logos. Every Windows core up to
# 0.2.3 therefore shipped Chromium's blue ball -- on the taskbar, in Alt-Tab, on
# every browser window -- beside an application called PiBrowse. A tester asked for
# the branded icons on 27.09.2026.
#
# Generated here from assets\icon.png rather than committed, for the reason
# .gitignore gives for core/branding: one source, so nobody ships two logos.
# PowerShell and System.Drawing keep the Windows build independent of Python.
# Product logos, SVGs and wordmarks retain their existing resource canvases.
#
# What Windows reads, and so what is written:
#   chromium\win\chromium.ico   IDR_MAINFRAME in chrome_exe.rc and chrome_dll.rc:
#                               the .exe, the taskbar, every window
#   chromium\win\app_list.ico   the same mark, for the app launcher entry
#   chromium\win\tiles\*.png    Start menu tiles (VisualElementsManifest)
#   chromium\product_logo_*.png and default_{100,200}_percent\chromium\
#                               product_logo_{16,32}.png: logos drawn inside the
#                               browser -- window icon, About, profile menu
# Each file keeps the pixel size of the one it replaces, read from that file,
# so an upstream size change is followed rather than overwritten.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root  = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$src = Join-Path $root 'assets\icon-browser.png'
if (-not (Test-Path $src)) { $src = Join-Path $root 'assets\icon.png' }
$checkout = if ($env:FURY_CHROMIUM_SRC) { $env:FURY_CHROMIUM_SRC } else { Join-Path $root 'core\src' }
$theme = Join-Path $checkout 'chrome\app\theme'
$componentsResources = Join-Path $checkout 'components\resources'
$wordmarkPath = Join-Path $root 'assets\pibrowse-logo.png'
$whiteWordmarkPath = Join-Path $root 'assets\pibrowse-logo-dark.png'
if (-not (Test-Path $wordmarkPath)) { $wordmarkPath = Join-Path $root 'assets\logo.png' }
if (-not (Test-Path $whiteWordmarkPath)) { $whiteWordmarkPath = Join-Path $root 'assets\logo-dark.png' }
foreach ($art in @($src, $wordmarkPath, $whiteWordmarkPath)) {
    if (-not (Test-Path $art)) { throw "Approved brand artwork is missing: $art" }
}
if (-not (Test-Path $theme)) { throw "No Chromium tree at $theme. Run fetch.sh first." }
$componentImages = @()
foreach ($scale in 100, 200) {
    foreach ($name in 'product_logo.png', 'product_logo_white.png', 'favicon_product.png') {
        $path = Join-Path $componentsResources "default_${scale}_percent\chromium\$name"
        if (-not (Test-Path $path)) { throw "Missing version-page product image: $path" }
        $componentImages += $path
    }
}

$master = [System.Drawing.Image]::FromFile($src)

function CropToInk([string]$path) {
    $image = [System.Drawing.Bitmap]::FromFile($path)
    $minX = $image.Width; $minY = $image.Height; $maxX = -1; $maxY = -1
    for ($y = 0; $y -lt $image.Height; $y++) {
        for ($x = 0; $x -lt $image.Width; $x++) {
            if ($image.GetPixel($x, $y).A -ne 0) {
                $minX = [Math]::Min($minX, $x); $maxX = [Math]::Max($maxX, $x)
                $minY = [Math]::Min($minY, $y); $maxY = [Math]::Max($maxY, $y)
            }
        }
    }
    if ($maxX -lt 0) { $image.Dispose(); throw "No visible artwork in $path" }
    $bounds = New-Object System.Drawing.Rectangle $minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1)
    $cropped = $image.Clone($bounds, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $image.Dispose()
    return $cropped
}

$wordmark = CropToInk $wordmarkPath
$whiteWordmark = CropToInk $whiteWordmarkPath

function RenderArtwork([System.Drawing.Image]$source, [int]$width, [int]$height) {
    $bmp = New-Object System.Drawing.Bitmap $width, $height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $scale = [Math]::Min($width / [double]$source.Width, $height / [double]$source.Height)
    $drawWidth = [Math]::Max(1, [int][Math]::Round($source.Width * $scale))
    $drawHeight = [Math]::Max(1, [int][Math]::Round($source.Height * $scale))
    $x = [int][Math]::Floor(($width - $drawWidth) / 2)
    $y = [int][Math]::Floor(($height - $drawHeight) / 2)
    $g.DrawImage($source, $x, $y, $drawWidth, $drawHeight)
    $g.Dispose()
    return $bmp
}

function Render([int]$size) { return (RenderArtwork $master $size $size) }

function PngBytes([int]$size) {
    $bmp = Render $size
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $bytes = $ms.ToArray(); $ms.Dispose()
    return ,$bytes
}

# The PNG this replaces, redrawn at its own size.
function ReplacePng([string]$path, [bool]$forceWordmark = $false) {
    if (-not (Test-Path $path)) { Write-Host "   -- absent, skipped: $path"; return }
    $old = [System.Drawing.Image]::FromFile($path)
    $w = $old.Width; $h = $old.Height
    $old.Dispose()
    $artwork = $master
    if ($forceWordmark -or ([System.IO.Path]::GetFileName($path) -match '(wordmark|logo_name)')) {
        $artwork = if ($path -match 'white') { $whiteWordmark } else { $wordmark }
    }
    $bmp = RenderArtwork $artwork $w $h
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    [System.IO.File]::WriteAllBytes($path, $ms.ToArray())
    $bmp.Dispose(); $ms.Dispose()
    Write-Host "   ${w}x${h} px  $path"
}

function ReplaceSvg([string]$path) {
    [xml]$old = Get-Content -LiteralPath $path -Raw
    $original = $old.DocumentElement
    $viewBox = $original.GetAttribute('viewBox')
    if ($viewBox) {
        $dimensions = $viewBox.Trim() -split '[\s,]+'
        if ($dimensions.Count -ne 4) { throw "Invalid SVG canvas in $path" }
        $x = $dimensions[0]; $y = $dimensions[1]
        $width = $dimensions[2]; $height = $dimensions[3]
    } else {
        $x = '0'; $y = '0'
        $width = $original.GetAttribute('width') -replace 'px$', ''
        $height = $original.GetAttribute('height') -replace 'px$', ''
        if (-not $width -or -not $height) { throw "Missing SVG canvas in $path" }
        $viewBox = "0 0 $width $height"
    }
    $xml = New-Object System.Xml.XmlDocument
    $svg = $xml.CreateElement('svg', 'http://www.w3.org/2000/svg')
    [void]$xml.AppendChild($svg)
    $svg.SetAttribute('viewBox', $viewBox)
    foreach ($attribute in 'width', 'height') {
        if ($original.HasAttribute($attribute)) { $svg.SetAttribute($attribute, $original.GetAttribute($attribute)) }
    }
    $image = $xml.CreateElement('image', 'http://www.w3.org/2000/svg')
    $image.SetAttribute('x', $x); $image.SetAttribute('y', $y)
    $image.SetAttribute('width', $width); $image.SetAttribute('height', $height)
    $image.SetAttribute('preserveAspectRatio', 'xMidYMid meet')
    $artworkPath = $src
    if ([System.IO.Path]::GetFileName($path) -match '(wordmark|logo_name)') {
        $artworkPath = if ($path -match 'white') { $whiteWordmarkPath } else { $wordmarkPath }
    }
    $image.SetAttribute('href', 'data:image/png;base64,' + [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($artworkPath)))
    [void]$svg.AppendChild($image)
    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Encoding = New-Object System.Text.UTF8Encoding $false
    $settings.OmitXmlDeclaration = $true
    $writer = [System.Xml.XmlWriter]::Create($path, $settings)
    $xml.Save($writer); $writer.Dispose()
    Write-Host "   svg $viewBox  $path"
}

# An .ico whose frames are PNGs -- the format Windows has read since Vista, and
# the one Chromium's own chromium.ico uses for its 256 px frame.
function WriteIco([string]$path, [int[]]$sizes) {
    $frames = @()
    foreach ($s in $sizes) { $frames += ,(PngBytes $s) }
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter $ms
    $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $s = $sizes[$i]; $len = $frames[$i].Length
        $dim = if ($s -ge 256) { 0 } else { $s }   # 0 means 256 in an ICONDIRENTRY
        $bw.Write([byte]$dim); $bw.Write([byte]$dim)
        $bw.Write([byte]0); $bw.Write([byte]0)       # no palette, reserved
        $bw.Write([UInt16]1); $bw.Write([UInt16]32)  # planes, bits per pixel
        $bw.Write([UInt32]$len); $bw.Write([UInt32]$offset)
        $offset += $len
    }
    foreach ($f in $frames) { $bw.Write($f) }
    $bw.Flush()
    [System.IO.File]::WriteAllBytes($path, $ms.ToArray())
    $bw.Dispose()
    Write-Host "   ico $($sizes -join ',')  $path"
}

Write-Host "==> Windows icons from $src"
$win = Join-Path $theme 'chromium\win'
WriteIco (Join-Path $win 'chromium.ico') @(16, 20, 24, 32, 40, 48, 64, 256)
WriteIco (Join-Path $win 'app_list.ico') @(16, 24, 32, 48, 256)
# chrome_exe.rc also embeds these icons for HTML/PDF file associations.
WriteIco (Join-Path $win 'chromium_doc.ico') @(16, 24, 32, 48, 64, 256)
WriteIco (Join-Path $win 'chromium_pdf.ico') @(16, 24, 32, 48, 64, 256)

Write-Host "==> product logos and wordmarks"
Get-ChildItem -LiteralPath $theme -Recurse -File | Where-Object {
    $_.FullName -match '[\\/]chromium[\\/]' -and $_.BaseName -match '(logo|wordmark)'
} | ForEach-Object {
    if ($_.Extension -eq '.png') { ReplacePng $_.FullName }
    elseif ($_.Extension -eq '.svg') { ReplaceSvg $_.FullName }
}

# IDR_PRODUCT_LOGO{,_WHITE} on chrome://version are wide component wordmarks,
# not square app icons, despite their short product_logo.png filenames.
foreach ($path in $componentImages) {
    ReplacePng $path ([System.IO.Path]::GetFileName($path) -ne 'favicon_product.png')
}

$master.Dispose(); $wordmark.Dispose(); $whiteWordmark.Dispose()
Write-Host "==> done"
