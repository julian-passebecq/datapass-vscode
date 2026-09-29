# Inspect the actual packaged ZIP, not just the source ignore rules. Never extracts files.
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$package = Get-Item -LiteralPath $Path
$archive = [System.IO.Compression.ZipFile]::OpenRead($package.FullName)
try {
    $unexpected = @($archive.Entries | Where-Object {
        $_.FullName.Replace('\', '/') -match '^extension/(\.ci-tools|\.ci-venv|\.cache)/'
    })
    if ($unexpected.Count -gt 0) { throw "VSIX contains $($unexpected.Count) CI-cache entries; refusing qualification." }
    $entryCount = $archive.Entries.Count
} finally {
    $archive.Dispose()
}
$digest = (Get-FileHash -LiteralPath $package.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($package.FullName + '.sha256', "$digest  $($package.Name)`n", [System.Text.UTF8Encoding]::new($false))
Write-Output "VSIX verified: $($package.Name); bytes=$($package.Length); entries=$entryCount; sha256=$digest; CI-cache entries=0"
