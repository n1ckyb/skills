<#
.SYNOPSIS
    Uninstalls skill-explorer global extension and skill directories.
.PARAMETER RemoveConfig
    If specified, removes ~/.copilot/skill-explorer-config.json.
#>
[CmdletBinding()]
param(
    [switch]$RemoveConfig
)

$ErrorActionPreference = "Stop"

$HomeDir = [Environment]::GetFolderPath('UserProfile')
$ExtDest = Join-Path $HomeDir ".copilot\extensions\skill-explorer"
$SkillDest = Join-Path $HomeDir ".agents\skills\skill-explorer"
$ConfigPath = Join-Path $HomeDir ".copilot\skill-explorer-config.json"

if (Test-Path $ExtDest) {
    Write-Host "Removing extension directory: $ExtDest"
    Remove-Item -Path $ExtDest -Recurse -Force
} else {
    Write-Host "Extension directory not found: $ExtDest"
}

if (Test-Path $SkillDest) {
    Write-Host "Removing skill directory: $SkillDest"
    Remove-Item -Path $SkillDest -Recurse -Force
} else {
    Write-Host "Skill directory not found: $SkillDest"
}

if ($RemoveConfig) {
    if (Test-Path $ConfigPath) {
        Write-Host "Removing configuration file: $ConfigPath"
        Remove-Item -Path $ConfigPath -Force
    }
} else {
    Write-Host "Preserved configuration file: $ConfigPath (use -RemoveConfig to delete)"
}

Write-Host "Skill Explorer uninstalled successfully." -ForegroundColor Green
