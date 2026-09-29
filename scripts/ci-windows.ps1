param([switch]$Node, [switch]$Python)
$ErrorActionPreference = 'Stop'
function Invoke-CiNative {
    param([string]$File)
    & $File @args
    if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE" }
}
if ($Node) {
    # Preserve the previous node:22 target without relying on the host's Node 26.
    $archive = 'node-v22.23.3-win-x64.zip'
    $toolRoot = Join-Path $PWD '.ci-tools\node'
    New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
    $zip = Join-Path $toolRoot $archive
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/v22.23.3/$archive" -OutFile $zip
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne '2B0FF57B049CDA1BBCEA2240EEC20467018713C1EFE1F7360C2681859B90ED71') { throw 'Node archive checksum mismatch' }
    Expand-Archive -LiteralPath $zip -DestinationPath $toolRoot -Force
    $env:PATH = "$(Join-Path $toolRoot 'node-v22.23.3-win-x64');$env:PATH"
    Invoke-CiNative node.exe -e "console.log(process.version, process.execPath); if (process.versions.node.split('.')[0] !== '22') process.exit(1)"
}
if ($Python) {
    $env:PYTHONUTF8 = '1'
    $script:CiPython = 'D:\PROJ\GitlabRunner\tools\python-3.12.10\tools\python.exe'
    if (-not (Test-Path -LiteralPath $CiPython -PathType Leaf)) { throw 'CPython 3.12 runtime is missing' }
    Invoke-CiNative $CiPython -c 'import sys; print(sys.version); print(sys.executable); assert sys.version_info[:2] == (3, 12); assert __debug__'
    Invoke-CiNative $CiPython -m venv .ci-venv
    $script:CiPython = Join-Path $PWD '.ci-venv\Scripts\python.exe'
    $env:PATH = "$(Join-Path $PWD '.ci-venv\Scripts');$env:PATH"
}
