param(
    [Parameter(Mandatory)][string]$Portable,
    [Parameter(Mandatory)][string]$Destination
)

$ErrorActionPreference = 'Stop'
$portablePath = (Resolve-Path -LiteralPath $Portable).Path
if (Test-Path -LiteralPath $Destination) { throw 'Extraction requires a new directory.' }
$outputDir = (New-Item -ItemType Directory -Path $Destination).FullName

# The NSIS launcher wraps one 7z application payload.
& 7z x -t7z -y "-o$outputDir" $portablePath | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Cannot extract Windows portable ($LASTEXITCODE)" }
$exe = Join-Path $outputDir '牛马鼓励器.exe'
if (!(Test-Path -LiteralPath $exe -PathType Leaf) -or !(Test-Path -LiteralPath (Join-Path $outputDir 'resources/app.asar') -PathType Leaf)) {
    throw 'Portable application files missing'
}
return $exe
