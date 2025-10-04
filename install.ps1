# Documentation Hub - Windows Installer Script
# This script downloads and installs the latest version of Documentation Hub

$ErrorActionPreference = "Stop"

Write-Host "Documentation Hub Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get latest release information from GitHub
Write-Host "Fetching latest release information..." -ForegroundColor Yellow
$releaseUrl = "https://api.github.com/repos/ItMeDiaTech/Documentation_Hub/releases/latest"

try {
    $release = Invoke-RestMethod -Uri $releaseUrl -Headers @{"User-Agent" = "Documentation-Hub-Installer"}
    $version = $release.tag_name
    Write-Host "Latest version: $version" -ForegroundColor Green
} catch {
    Write-Host "Error: Failed to fetch release information" -ForegroundColor Red
    Write-Host "Please check your internet connection and try again." -ForegroundColor Red
    exit 1
}

# Find the Windows installer asset
$asset = $release.assets | Where-Object { $_.name -like "*.exe" } | Select-Object -First 1

if (-not $asset) {
    Write-Host "Error: No Windows installer found in the latest release" -ForegroundColor Red
    exit 1
}

$downloadUrl = $asset.browser_download_url
$installerName = $asset.name
$downloadPath = Join-Path $env:TEMP $installerName

Write-Host "Downloading $installerName..." -ForegroundColor Yellow
Write-Host "URL: $downloadUrl" -ForegroundColor Gray

try {
    # Download the installer with progress
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $downloadUrl -OutFile $downloadPath -Headers @{"User-Agent" = "Documentation-Hub-Installer"}
    $ProgressPreference = 'Continue'
    Write-Host "Download complete!" -ForegroundColor Green
} catch {
    Write-Host "Error: Failed to download installer" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Verify file exists
if (-not (Test-Path $downloadPath)) {
    Write-Host "Error: Downloaded file not found" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Running installer..." -ForegroundColor Yellow
Write-Host "Note: The installer will open in a separate window." -ForegroundColor Cyan
Write-Host ""

try {
    # Run the installer
    Start-Process -FilePath $downloadPath -Wait
    Write-Host "Installation completed successfully!" -ForegroundColor Green
} catch {
    Write-Host "Error: Failed to run installer" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Clean up
Write-Host "Cleaning up temporary files..." -ForegroundColor Yellow
Remove-Item $downloadPath -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Documentation Hub has been installed!" -ForegroundColor Green
Write-Host "You can now launch it from the Start Menu or Desktop." -ForegroundColor Cyan
Write-Host ""
