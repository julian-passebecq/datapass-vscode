param([Parameter(Mandatory=$true)][ValidateSet('native','ui')][string]$Mode)
$ErrorActionPreference = 'Stop'
$projectRoot = (Get-Location).Path
$vsix = Get-ChildItem -LiteralPath $projectRoot -Filter '*.vsix' -File | Select-Object -First 1
if (-not $vsix) { throw 'Packaged VSIX artifact missing' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$arguments = @((Join-Path $projectRoot 'node_modules\tsx\dist\cli.mjs'))
if ($Mode -eq 'native') {
    $arguments += @('scripts/desktop-test.ts', "--vsix=$($vsix.FullName)", '--fixture=v6-intelligence', '--probe-native-controller')
} else {
    $arguments += @('--test', '--test-concurrency=1', 'tests/qaPrepare.test.ts', 'tests/qaAuto.test.ts', 'tests/qa-ui.smoke.test.ts', 'tests/qa-v6.smoke.test.ts')
}
if (-not [Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) {
    $env:DATAPASS_QA_VSIX = $vsix.FullName
    & $node @arguments
    if ($LASTEXITCODE -ne 0) { throw "Desktop $Mode qualification failed: $LASTEXITCODE" }
    return
}
# LPAC _ctypes initialization is refused in the LocalSystem service context on this runner.
# Exercise the actual desktop context; no service account, runtime ACL or parser policy changes.
if ($env:CI_PROJECT_PATH -ne 'juliandatapass-group/datapass-vscode' -or -not $env:CI_JOB_ID) { throw 'Interactive qualification requires the DataPass CI job' }
if ((Get-Content -LiteralPath (Join-Path $projectRoot '.git\HEAD') -Raw).Trim() -ne $env:CI_COMMIT_SHA) { throw 'CI checkout source mismatch' }
$account = (Get-CimInstance Win32_ComputerSystem).UserName
if (-not $account) { throw 'No logged-on desktop user: qualification cannot run' }
$sid = [Security.Principal.NTAccount]::new($account).Translate([Security.Principal.SecurityIdentifier])
if ($sid.Value -notmatch '^S-1-5-21-[0-9-]+$') { throw 'Qualification needs an ordinary logged-on user' }
$out = Join-Path $projectRoot 'out'
New-Item -ItemType Directory -Force -Path $out | Out-Null
# Only this job's disposable output tree needs user writes; source/package inputs retain their ACLs.
$acl = Get-Acl -LiteralPath $out
$rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $out -AclObject $acl
$taskName = 'DataPassQualification-' + $env:CI_JOB_ID + '-' + [guid]::NewGuid().ToString('N')
$taskRoot = Join-Path $out $taskName
New-Item -ItemType Directory -Path $taskRoot | Out-Null
$config = Join-Path $taskRoot 'input.json'
$driver = Join-Path $taskRoot 'entry.ps1'
$resultFile = Join-Path $taskRoot 'result.json'
$logFile = Join-Path $taskRoot 'output.log'
$environment = @{}
foreach ($key in @('CI_NODE_INDEX','CI_NODE_TOTAL','DATAPASS_TEST_VSCODE_VERSION')) {
    $value = [Environment]::GetEnvironmentVariable($key)
    if ($value) { $environment[$key] = $value }
}
# No CI credentials/tokens are transferred to the desktop session.
$environment['DATAPASS_QA_VSIX'] = $vsix.FullName
$environment['PATH'] = $env:PATH
$environment['GIT_CONFIG_COUNT'] = '2'
$environment['GIT_CONFIG_KEY_0'] = 'core.longpaths'
$environment['GIT_CONFIG_VALUE_0'] = 'true'
$environment['GIT_CONFIG_KEY_1'] = 'safe.directory'
$environment['GIT_CONFIG_VALUE_1'] = $projectRoot.Replace('\','/')
@{ node=$node; arguments=$arguments; root=$projectRoot; environment=$environment; result=$resultFile; log=$logFile;
   source=$env:CI_COMMIT_SHA; vsixSha256=(Get-FileHash -LiteralPath $vsix.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $config -Encoding UTF8
@'
param([string]$Config)
$ErrorActionPreference = 'Stop'
$inputData = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$code = 1
try {
    foreach ($property in $inputData.environment.PSObject.Properties) { [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process') }
    Set-Location -LiteralPath $inputData.root
    $arguments = @($inputData.arguments)
    & $inputData.node @arguments *> $inputData.log
    $code = $LASTEXITCODE
} catch { $_ | Out-String | Add-Content -LiteralPath $inputData.log }
finally {
    @{ exitCode=$code; source=$inputData.source; vsixSha256=$inputData.vsixSha256;
       userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; systemProfile=[Security.Principal.WindowsIdentity]::GetCurrent().IsSystem } |
        ConvertTo-Json | Set-Content -LiteralPath ($inputData.result + '.tmp') -Encoding UTF8
    Move-Item -LiteralPath ($inputData.result + '.tmp') -Destination $inputData.result
}
exit $code
'@ | Set-Content -LiteralPath $driver -Encoding UTF8
$registered = $false
try {
    $shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $action = New-ScheduledTaskAction -Execute $shell -Argument "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File `"$driver`" -Config `"$config`"" -WorkingDirectory $projectRoot
    $principal = New-ScheduledTaskPrincipal -UserId $sid.Value -LogonType Interactive -RunLevel Limited
    $minutes = if ($Mode -eq 'native') { 15 } else { 40 }
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes $minutes) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings | Out-Null
    $registered = $true
    Write-Host "Desktop $Mode qualification: existing interactive user $($sid.Value), least privilege, task $taskName"
    Start-ScheduledTask -TaskName $taskName
    $deadline = (Get-Date).AddMinutes($minutes)
    while (-not (Test-Path -LiteralPath $resultFile)) {
        if ((Get-Date) -gt $deadline) { throw 'Desktop qualification deadline expired' }
        Start-Sleep -Seconds 2
    }
    Get-Content -LiteralPath $logFile
    $result = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
    if ($result.systemProfile -or $result.userSid -ne $sid.Value -or $result.source -ne $env:CI_COMMIT_SHA) { throw 'Desktop qualification context mismatch' }
    Write-Host ($result | ConvertTo-Json -Compress)
    if ($result.exitCode -ne 0) { throw "Desktop $Mode qualification failed: $($result.exitCode)" }
} finally {
    if ($registered) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "Removed temporary qualification task $taskName"
    }
}
