param(
    [string]$OutputPath = "docs/ssot/control-db-schema.sql"
)

$ErrorActionPreference = "Stop"

function Resolve-SupabaseCli {
    $command = Get-Command supabase -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $scoopPath = Join-Path $env:USERPROFILE "scoop\apps\supabase\current\supabase.exe"
    if (Test-Path $scoopPath) {
        return $scoopPath
    }

    $versionedPath = Join-Path $env:USERPROFILE "scoop\apps\supabase\2.84.2\supabase.exe"
    if (Test-Path $versionedPath) {
        return $versionedPath
    }

    throw "Supabase CLI not found in PATH or Scoop."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$absoluteOutputPath = Join-Path $repoRoot $OutputPath
$outputDir = Split-Path -Parent $absoluteOutputPath

if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$supabaseCli = Resolve-SupabaseCli

Write-Host "Exporting linked control DB schema to $absoluteOutputPath"
& $supabaseCli db dump --linked --keep-comments --file $absoluteOutputPath

if ($LASTEXITCODE -ne 0) {
    throw "Supabase schema export failed with exit code $LASTEXITCODE."
}

Write-Host "Schema export complete."
