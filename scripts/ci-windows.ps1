param([switch]$Node, [switch]$Python)
$ErrorActionPreference = 'Stop'
function Invoke-CiNative {
    param([string]$File)
    & $File @args
    if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE" }
}
if ($Node) {
    # Preserve the previous node:22 target without relying on the host's Node 26.
    # CIBOOT1: Windows PowerShell 5.1 renders a progress bar for Invoke-WebRequest and Expand-Archive
    # that slows both by orders of magnitude on a busy runner (16 min on a green run, > 43 min hangs
    # that hit the job token limit). Silence progress, keep the checked zip in the job cache, extract
    # with the built-in bsdtar, and bound every download so a stall fails clearly.
    $ProgressPreference = 'SilentlyContinue'
    $archive = 'node-v22.23.3-win-x64.zip'
    $sha256 = '2B0FF57B049CDA1BBCEA2240EEC20467018713C1EFE1F7360C2681859B90ED71'
    $toolRoot = Join-Path $PWD '.ci-tools\node'
    $zipRoot = Join-Path $PWD '.cache\node'
    New-Item -ItemType Directory -Force -Path $toolRoot, $zipRoot | Out-Null
    $zip = Join-Path $zipRoot $archive
    $cached = (Test-Path -LiteralPath $zip -PathType Leaf) -and ((Get-FileHash $zip -Algorithm SHA256).Hash -eq $sha256)
    if (-not $cached) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        for ($attempt = 1; ; $attempt++) {
            try {
                Invoke-WebRequest -UseBasicParsing -TimeoutSec 300 "https://nodejs.org/dist/v22.23.3/$archive" -OutFile $zip
                break
            } catch {
                if ($attempt -ge 3) { throw }
                Write-Host "Node download attempt $attempt failed: $($_.Exception.Message); retrying"
            }
        }
    }
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $sha256) { throw 'Node archive checksum mismatch' }
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (Test-Path -LiteralPath $tar -PathType Leaf) {
        Invoke-CiNative $tar -xf $zip -C $toolRoot
    } else {
        Expand-Archive -LiteralPath $zip -DestinationPath $toolRoot -Force
    }
    $env:PATH = "$(Join-Path $toolRoot 'node-v22.23.3-win-x64');$env:PATH"
    Invoke-CiNative node.exe -e "console.log(process.version, process.execPath); if (process.versions.node.split('.')[0] !== '22') process.exit(1)"
}
if ($Python) {
    $env:PYTHONUTF8 = '1'
    $script:CiPython = 'D:\PROJ\GitlabRunner\tools\python-3.12.10\tools\python.exe'
    if (-not (Test-Path -LiteralPath $CiPython -PathType Leaf)) { throw 'CPython 3.12 runtime is missing' }
    Invoke-CiNative $CiPython -c 'import sys; print(sys.version); print(sys.executable); sys.exit(0 if sys.version_info[:2] == (3, 12) and __debug__ and not sys.flags.optimize else 1)'
    Invoke-CiNative $CiPython -m venv .ci-venv
    $script:CiPython = Join-Path $PWD '.ci-venv\Scripts\python.exe'
    $env:PATH = "$(Join-Path $PWD '.ci-venv\Scripts');$env:PATH"
}
