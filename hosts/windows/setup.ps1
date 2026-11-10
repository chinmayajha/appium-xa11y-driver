# Prepares a Windows Host for the xa11y driver. Safe to run again: it changes only what is missing.
param(
  [string]$Driver = 'appium-xa11y-driver',
  [string]$Address = '127.0.0.1',
  [int]$Port = 4723,
  [switch]$NoService
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$NodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { '22.23.3' }
$AppiumVersion = if ($env:APPIUM_VERSION) { $env:APPIUM_VERSION } else { '3.9.0' }
$Root = if ($env:XA11Y_HOME) { $env:XA11Y_HOME } else { Join-Path $env:LOCALAPPDATA 'appium-xa11y' }
$Task = 'appium-xa11y'
$AppiumHome = Join-Path $Root 'appium-home'
$AppiumCmd = Join-Path $Root 'appium\node_modules\.bin\appium.cmd'

function Log($Message) { Write-Host "==> $Message" }

function Invoke-Checked {
  $exe = $args[0]
  $rest = @($args | Select-Object -Skip 1)
  & $exe @rest
  if ($LASTEXITCODE -ne 0) { throw "$exe $rest failed with exit code $LASTEXITCODE" }
}

function Invoke-Quiet {
  # Windows PowerShell 5.1 turns redirected stderr into a terminating error when the preference is Stop.
  $ErrorActionPreference = 'Continue'
  $exe = $args[0]
  $rest = @($args | Select-Object -Skip 1)
  & $exe @rest 2>$null
}

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Install-Runtime {
  $dll = "$env:WINDIR\System32\vcruntime140_1.dll"
  if (Test-Path $dll) { return }
  if (-not (Test-Admin)) { throw 'The Visual C++ 2015-2022 runtime is missing. Run this script one time as an administrator.' }
  Log 'Installing the Visual C++ 2015-2022 runtime'
  $installer = Join-Path $Root 'vc_redist.x64.exe'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile $installer
  Start-Process $installer -ArgumentList '/install', '/quiet', '/norestart' -Wait
  Remove-Item $installer
  if (-not (Test-Path $dll)) { throw 'The Visual C++ 2015-2022 runtime did not install' }
}

function Test-NodeOnPath {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  $major, $minor = (& node -p 'process.versions.node').Split('.')[0, 1] | ForEach-Object { [int]$_ }
  ($major -ge 24) -or ($major -eq 22 -and $minor -ge 12) -or ($major -eq 20 -and $minor -ge 19)
}

function Install-Node {
  $own = Join-Path $Root 'node'
  if ($NoService -and (Test-NodeOnPath)) { return }
  $env:Path = "$own;$env:Path"
  if ((Test-Path "$own\node.exe") -and ((& "$own\node.exe" -v) -eq "v$NodeVersion")) { return }
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $name = "node-v$NodeVersion-win-$arch"
  $url = "https://nodejs.org/dist/v$NodeVersion"
  Log "Installing Node.js $NodeVersion in $own"
  Invoke-WebRequest -UseBasicParsing -Uri "$url/$name.zip" -OutFile "$Root\$name.zip"
  Invoke-WebRequest -UseBasicParsing -Uri "$url/SHASUMS256.txt" -OutFile "$Root\SHASUMS256.txt"
  $want = ((Select-String -Path "$Root\SHASUMS256.txt" -Pattern "  $name\.zip$").Line -split '\s+')[0]
  if (-not $want -or (Get-FileHash "$Root\$name.zip" -Algorithm SHA256).Hash -ne $want.ToUpper()) {
    throw 'The Node.js download does not match SHASUMS256.txt'
  }
  if (Test-Path $own) { Remove-Item $own -Recurse -Force }
  Expand-Archive "$Root\$name.zip" -DestinationPath $Root
  Rename-Item "$Root\$name" 'node'
  Remove-Item "$Root\$name.zip", "$Root\SHASUMS256.txt"
}

function Install-Appium {
  if ((Test-Path $AppiumCmd) -and ((Invoke-Quiet $AppiumCmd --version) -eq $AppiumVersion)) { return }
  Log "Installing Appium $AppiumVersion in $Root\appium"
  Invoke-Checked npm.cmd install --prefix "$Root\appium" --no-audit --no-fund --loglevel=error "appium@$AppiumVersion"
}

function Get-InstalledDriver {
  $json = (Invoke-Quiet $AppiumCmd driver list --installed --json) -join "`n"
  if (-not $json) { return $null }
  try { ($json | ConvertFrom-Json).xa11y } catch { $null }
}

function Install-Driver {
  $source = 'npm'
  $spec = $Driver
  if (Test-Path $Driver -PathType Container) {
    $source = 'local'
    $spec = (Resolve-Path $Driver).Path
    Log "Building the driver in $spec"
    Push-Location $spec
    try {
      if (-not (Test-Path node_modules)) { Invoke-Checked npm.cmd ci --no-audit --no-fund --loglevel=error }
      Invoke-Checked npm.cmd run build
    } finally { Pop-Location }
  }
  $installed = Get-InstalledDriver
  if ($installed -and $installed.installType -eq $source -and $installed.installSpec -eq $spec) {
    # An npm spec with a version or tag after the name is a pin, so only a bare name follows new releases.
    if ($source -eq 'npm' -and -not $spec.TrimStart('@').Contains('@')) { Invoke-Quiet $AppiumCmd driver update xa11y | Out-Null }
    Log "The driver is installed from ${source}: $spec"
    return
  }
  if ($installed) {
    Log "Removing the driver installed from $($installed.installType): $($installed.installSpec)"
    Invoke-Checked $AppiumCmd driver uninstall xa11y
  }
  Log "Installing the driver from ${source}: $spec"
  Invoke-Checked $AppiumCmd driver install "--source=$source" $spec
}

function Write-HostScript {
  $nodeDir = Join-Path $Root 'node'
  Set-Content (Join-Path $Root 'host.ps1') @"
if (Test-Path '$nodeDir\node.exe') { `$env:Path = '$nodeDir;' + `$env:Path }
`$env:APPIUM_HOME = '$AppiumHome'
& '$AppiumCmd' --address $Address --port $Port --log-timestamp
"@
}

function Register-Service {
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $run = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"& '$Root\host.ps1' *>> '$Root\appium.log'`""
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $run
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
  $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $Task
  Log "Appium runs as the logon task '$Task' of $me. The log is $Root\appium.log"
}

New-Item -ItemType Directory -Force $Root | Out-Null
$env:APPIUM_HOME = $AppiumHome
Install-Runtime
Install-Node
Install-Appium
Install-Driver
Write-HostScript
if ($NoService) {
  Log "Installed. Start Appium with: powershell -ExecutionPolicy Bypass -File `"$Root\host.ps1`""
} else {
  Register-Service
}
Log 'Appium must run in the desktop session of a logged-on user. A disconnected Remote Desktop session locks the desktop: input fails and screenshots are black.'
