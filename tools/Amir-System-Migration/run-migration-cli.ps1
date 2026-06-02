Param(
  [ValidateSet("menu", "wizard", "run", "summarize-report")]
  [string]$Mode = "menu",
  [ValidateSet("inventory", "riders-core", "lessons-candidates", "all")]
  [string]$Job = "all",
  [string]$MdbPath = "",
  [string]$ReportPath = "",
  [string]$SummaryOutput = "",
  [string]$PasswordEnv = "MDB_PASSWORD",
  [int]$SampleRows = 10,
  [string]$OutputDir = "",
  [switch]$NoPause
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
  Write-Host "  4) all"
  $jobChoice = (Read-Host "Enter 1-4 [4]").Trim()
  if ([string]::IsNullOrWhiteSpace($jobChoice)) { $jobChoice = "4" }
  switch ($jobChoice) {
    "1" { $Job = "inventory" }
    "2" { $Job = "riders-core" }
    "3" { $Job = "lessons-candidates" }
    "4" { $Job = "all" }
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