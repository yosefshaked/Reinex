Param(
  [ValidateSet("menu", "wizard", "run", "summarize-report")]
  [string]$Mode = "menu",
  [ValidateSet("inventory", "riders-core", "lessons-candidates", "extract", "all")]
  [string]$Job = "all",
  [string]$MdbPath = "",
  [string]$ReportPath = "",
  [string]$SummaryOutput = "",
  [string]$PasswordEnv = "MDB_PASSWORD",
  [int]$SampleRows = 10,
  [string]$Tables = "",
  [string]$OutputDir = "",
  [switch]$NoPause,
  [switch]$NoDepCheck
)

if (-not $OutputDir -or $OutputDir.Trim() -eq "") {
  $OutputDir = Join-Path $PSScriptRoot "output"
}

$scriptPath = Join-Path $PSScriptRoot "migration_cli.py"
if (-not (Test-Path $scriptPath)) {
  Write-Error "Cannot find migration_cli.py at $scriptPath"
  exit 1
}

$pythonExe = "C:/Users/Admin/AppData/Local/Programs/Python/Python313/python.exe"
if (-not (Test-Path $pythonExe)) {
  $pythonExe = "python"
}

# Ensure pywin32 (win32com) is available for the resolved Python. Installs only when
# missing, so normal runs aren't slowed down. Skip with -NoDepCheck.
if (-not $NoDepCheck) {
  & $pythonExe -c "import win32com.client" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Dependency 'pywin32' (win32com) not found for '$pythonExe' - installing..."
    $reqPath = Join-Path $PSScriptRoot "requirements.txt"
    if (Test-Path $reqPath) {
      & $pythonExe -m pip install -r $reqPath
    } else {
      & $pythonExe -m pip install pywin32
    }
    if ($LASTEXITCODE -ne 0) {
      Write-Error "Failed to install pywin32. Install it manually: $pythonExe -m pip install pywin32"
      if (-not $NoPause) { Read-Host "Press Enter to close" }
      exit 1
    }
    # Re-verify (pywin32 occasionally needs its post-install step).
    & $pythonExe -c "import win32com.client" 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "pywin32 installed but win32com is not importable yet - running post-install..."
      & $pythonExe -m pywin32_postinstall -install 2>$null
      & $pythonExe -c "import win32com.client" 2>$null
      if ($LASTEXITCODE -ne 0) {
        Write-Error "win32com still not importable. Try a new terminal, or: $pythonExe -m pywin32_postinstall -install"
        if (-not $NoPause) { Read-Host "Press Enter to close" }
        exit 1
      }
    }
    Write-Host "pywin32 is ready."
    Write-Host ""
  }
}

$resolvedMode = $Mode
if ($resolvedMode -eq "menu") {
  Write-Host "Select launcher mode:"
  Write-Host "  1) wizard"
  Write-Host "  2) run"
  Write-Host "  3) summarize-report"
  $modeChoice = (Read-Host "Enter 1-3 [1]").Trim()
  if ([string]::IsNullOrWhiteSpace($modeChoice)) { $modeChoice = "1" }

  switch ($modeChoice) {
    "1" { $resolvedMode = "wizard" }
    "2" { $resolvedMode = "run" }
    "3" { $resolvedMode = "summarize-report" }
    default {
      Write-Error "Invalid selection: $modeChoice"
      exit 2
    }
  }
}

if ($resolvedMode -eq "run" -and ($Job -eq "all" -or [string]::IsNullOrWhiteSpace($Job))) {
  Write-Host "Select job:"
  Write-Host "  1) inventory"
  Write-Host "  2) riders-core"
  Write-Host "  3) lessons-candidates"
  Write-Host "  4) extract (import-ready CSVs)"
  Write-Host "  5) all"
  $jobChoice = (Read-Host "Enter 1-5 [5]").Trim()
  if ([string]::IsNullOrWhiteSpace($jobChoice)) { $jobChoice = "5" }
  switch ($jobChoice) {
    "1" { $Job = "inventory" }
    "2" { $Job = "riders-core" }
    "3" { $Job = "lessons-candidates" }
    "4" { $Job = "extract" }
    "5" { $Job = "all" }
    default {
      Write-Error "Invalid selection: $jobChoice"
      exit 2
    }
  }
}

$effectiveMdbPath = $MdbPath
if (($resolvedMode -eq "wizard" -or $resolvedMode -eq "run") -and [string]::IsNullOrWhiteSpace($effectiveMdbPath)) {
  $effectiveMdbPath = Read-Host "MDB path"
}

$effectiveReportPath = $ReportPath
if ($resolvedMode -eq "summarize-report" -and [string]::IsNullOrWhiteSpace($effectiveReportPath)) {
  $effectiveReportPath = Read-Host "Report JSON path"
}

$args = @($scriptPath)

if ($resolvedMode -eq "wizard") {
  $args += @("wizard", "--password-env", $PasswordEnv, "--sample-rows", "$SampleRows", "--output-dir", $OutputDir)
  if ($effectiveMdbPath -and $effectiveMdbPath.Trim() -ne "") {
    $args += @("--mdb", $effectiveMdbPath)
  }
}
elseif ($resolvedMode -eq "run") {
  if (-not $effectiveMdbPath -or $effectiveMdbPath.Trim() -eq "") {
    Write-Error "Mode 'run' requires -MdbPath"
    exit 2
  }
  $args += @("run", $Job, "--mdb", $effectiveMdbPath, "--password-env", $PasswordEnv, "--sample-rows", "$SampleRows", "--output-dir", $OutputDir)
  if ($Tables -and $Tables.Trim() -ne "") {
    $args += @("--tables", $Tables)
  }
}
elseif ($resolvedMode -eq "summarize-report") {
  if (-not $effectiveReportPath -or $effectiveReportPath.Trim() -eq "") {
    Write-Error "Mode 'summarize-report' requires -ReportPath"
    exit 2
  }
  $args += @("summarize-report", "--report", $effectiveReportPath)
  if ($SummaryOutput -and $SummaryOutput.Trim() -ne "") {
    $args += @("--output", $SummaryOutput)
  }
}

Write-Host "Amir Migration CLI Launcher"
Write-Host "  Mode      : $resolvedMode"
if ($resolvedMode -eq "run") { Write-Host "  Job       : $Job" }
if ($effectiveMdbPath -and $effectiveMdbPath.Trim() -ne "") { Write-Host "  MDB Path  : $effectiveMdbPath" }
if ($effectiveReportPath -and $effectiveReportPath.Trim() -ne "") { Write-Host "  Report    : $effectiveReportPath" }
Write-Host "  OutputDir : $OutputDir"
Write-Host ""

& $pythonExe @args
$exitCode = $LASTEXITCODE

Write-Host ""
Write-Host "Process finished with exit code: $exitCode"
if ($exitCode -eq 0) {
  Write-Host "Tip: reports are under $OutputDir"
}

if (-not $NoPause) {
  Read-Host "Press Enter to close"
}

exit $exitCode