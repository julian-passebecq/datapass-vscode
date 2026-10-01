param([switch]$Node, [switch]$Python)
$ErrorActionPreference = 'Stop'
function Invoke-CiNative {
    param([string]$File)
    & $File @args
    if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE" }
}
if ($Node) {
    # Preserve the previous node:22 target without relying on the host's Node 26.
    # .ci-tools is kept out of git clean (GIT_CLEAN_FLAGS): a verified install is reused, and a new one is
    # staged in a per-job folder then renamed into place, so no job ever sees a half-written or half-deleted Node.
    $name = 'node-v22.23.3-win-x64'
    $sha = '2B0FF57B049CDA1BBCEA2240EEC20467018713C1EFE1F7360C2681859B90ED71'
    # CIFIX2 (port of cloud): a new root, not the old '.ci-tools\node' that older commits extract over in place.
    $toolRoot = Join-Path $PWD '.ci-tools\node-verified'
    $nodeHome = Join-Path $toolRoot $name
    function Test-CiNode([string]$Dir) {
        $marker = Join-Path $Dir '.ci-sha256'
        (Test-Path -LiteralPath (Join-Path $Dir 'node.exe') -PathType Leaf) -and (Test-Path -LiteralPath $marker -PathType Leaf) -and ((Get-Content -LiteralPath $marker -Raw).Trim() -eq $sha)
    }
    if (-not (Test-CiNode $nodeHome)) {
        # CIBOOT1: Windows PowerShell 5.1 renders a progress bar for
        # Invoke-WebRequest and Expand-Archive that slows both by orders of magnitude on a busy runner (16 min
        # runs, hangs past the job token limit). Silence progress, keep the checked zip in the job cache
        # (.cache/node), extract with the built-in bsdtar, and bound every download so a stall fails clearly.
        $ProgressPreference = 'SilentlyContinue'
        $zipRoot = Join-Path $PWD '.cache\node'
        New-Item -ItemType Directory -Force -Path $toolRoot, $zipRoot | Out-Null
        $stage = Join-Path $toolRoot ('stage-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $stage | Out-Null
        $zip = Join-Path $zipRoot "$name.zip"
        $cached = (Test-Path -LiteralPath $zip -PathType Leaf) -and ((Get-FileHash $zip -Algorithm SHA256).Hash -eq $sha)
        if (-not $cached) {
            # Download into the per-job stage, then publish to the cache; a concurrent job never reads a partial zip.
            $part = Join-Path $stage "$name.zip"
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            for ($attempt = 1; ; $attempt++) {
                try {
                    Invoke-WebRequest -UseBasicParsing -TimeoutSec 300 "https://nodejs.org/dist/v22.23.3/$name.zip" -OutFile $part
                    break
                } catch {
                    if ($attempt -ge 3) { throw }
                    Write-Host "Node download attempt $attempt failed: $($_.Exception.Message); retrying"
                }
            }
            if ((Get-FileHash $part -Algorithm SHA256).Hash -ne $sha) { throw 'Node archive checksum mismatch' }
            try { Move-Item -LiteralPath $part -Destination $zip -Force -ErrorAction Stop } catch { $zip = $part }
        }
        if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $sha) { throw 'Node archive checksum mismatch' }
        $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
        if (Test-Path -LiteralPath $tar -PathType Leaf) {
            Invoke-CiNative $tar -xf $zip -C $stage
        } else {
            Expand-Archive -LiteralPath $zip -DestinationPath $stage
        }
        if ($zip.StartsWith($stage)) { Remove-Item -LiteralPath $zip -Force }
        $staged = Join-Path $stage $name
        Set-Content -LiteralPath (Join-Path $staged '.ci-sha256') -Value $sha -Encoding Ascii
        # A damaged install is replaced; if a lingering process still locks it, run from the stage.
        if (Test-Path -LiteralPath $nodeHome) { Remove-Item -LiteralPath $nodeHome -Recurse -Force -ErrorAction SilentlyContinue }
        if (-not (Test-Path -LiteralPath $nodeHome)) {
            try { Move-Item -LiteralPath $staged -Destination $nodeHome -ErrorAction Stop } catch { Write-Host "Node stays staged: $($_.Exception.Message)" }
        }
        if (Test-CiNode $nodeHome) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue } else { $nodeHome = $staged }
    }
    if (-not (Test-CiNode $nodeHome)) { throw "Node $name is not installed at $nodeHome" }
    Get-ChildItem -LiteralPath $toolRoot -Directory -Filter 'stage-*' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-6) } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    $env:PATH = "$nodeHome;$env:PATH"
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
