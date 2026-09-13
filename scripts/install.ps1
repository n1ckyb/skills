<#
.SYNOPSIS
    Installs skill-explorer global extension and skill with atomic staged replacement and backup rollback.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageDir = Split-Path -Parent $ScriptDir

$HomeDir = [Environment]::GetFolderPath('UserProfile')
$ExtDest = Join-Path $HomeDir ".copilot\extensions\skill-explorer"
$SkillDest = Join-Path $HomeDir ".agents\skills\skill-explorer"

$SourceExtDir = Join-Path $PackageDir "extensions\skill-explorer"
$SourceSkillDir = Join-Path $PackageDir "skills\skill-explorer"

if (-not (Test-Path (Join-Path $SourceExtDir "extension.mjs"))) {
    throw "Source extension.mjs not found in '$SourceExtDir'"
}
if (-not (Test-Path (Join-Path $SourceSkillDir "SKILL.md"))) {
    throw "Source SKILL.md not found in '$SourceSkillDir'"
}

$SessionTag = [Guid]::NewGuid().ToString("N").Substring(0, 8)
$ExtStaging = "$ExtDest.staging-$SessionTag"
$SkillStaging = "$SkillDest.staging-$SessionTag"
$ExtBackup = "$ExtDest.backup-$SessionTag"
$SkillBackup = "$SkillDest.backup-$SessionTag"

try {
    Write-Host "Creating staging directories..."
    New-Item -ItemType Directory -Path $ExtStaging -Force | Out-Null
    New-Item -ItemType Directory -Path $SkillStaging -Force | Out-Null

    Write-Host "Copying extension files to staging..."
    Copy-Item -Path "$SourceExtDir\*" -Destination $ExtStaging -Recurse -Force

    Write-Host "Copying skill files to staging..."
    Copy-Item -Path "$SourceSkillDir\*" -Destination $SkillStaging -Recurse -Force

    # Extension atomic replacement
    if (Test-Path $ExtDest) {
        Write-Host "Backing up existing extension..."
        Move-Item -Path $ExtDest -Destination $ExtBackup -Force
    }
    Write-Host "Activating extension..."
    Move-Item -Path $ExtStaging -Destination $ExtDest -Force

    # Skill atomic replacement
    if (Test-Path $SkillDest) {
        Write-Host "Backing up existing skill..."
        Move-Item -Path $SkillDest -Destination $SkillBackup -Force
    }
    Write-Host "Activating skill..."
    Move-Item -Path $SkillStaging -Destination $SkillDest -Force

    # Clean backups after successful move
    if (Test-Path $ExtBackup) { Remove-Item -Path $ExtBackup -Recurse -Force }
    if (Test-Path $SkillBackup) { Remove-Item -Path $SkillBackup -Recurse -Force }

    Write-Host "Skill Explorer successfully installed to global locations:" -ForegroundColor Green
    Write-Host "  Extension: $ExtDest"
    Write-Host "  Skill:     $SkillDest"
}
catch {
    Write-Error "Installation failed: $_"

    # Rollback
    if (Test-Path $ExtStaging) { Remove-Item -Path $ExtStaging -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path $SkillStaging) { Remove-Item -Path $SkillStaging -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path $ExtBackup -and -not (Test-Path $ExtDest)) { Move-Item -Path $ExtBackup -Destination $ExtDest -Force -ErrorAction SilentlyContinue }
    if (Test-Path $SkillBackup -and -not (Test-Path $SkillDest)) { Move-Item -Path $SkillBackup -Destination $SkillDest -Force -ErrorAction SilentlyContinue }

    throw
}
