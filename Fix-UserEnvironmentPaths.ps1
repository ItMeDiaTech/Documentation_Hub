Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
.\Fix-UserEnvironmentPaths.ps1

#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Cleans up and fixes Windows 11 User Environment Variables and Paths
.DESCRIPTION
    This script performs comprehensive cleanup of User Environment Variables:
    - Removes duplicate paths
    - Removes invalid/non-existent paths
    - Adds missing standard Windows 11 user paths
    - Creates backup before making changes
    - Provides detailed logging
.AUTHOR
    System Administrator Script
.VERSION
    1.0.0
.EXAMPLE
    .\Fix-UserEnvironmentPaths.ps1
    .\Fix-UserEnvironmentPaths.ps1 -WhatIf
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter()]
    [string]$BackupPath = "$env:USERPROFILE\Documents\EnvBackup",

    [Parameter()]
    [switch]$SkipBackup,

    [Parameter()]
    [switch]$Force,

    [Parameter()]
    [string]$LogPath = "$env:TEMP\EnvironmentCleanup_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
)

# Script configuration
$ErrorActionPreference = 'Stop'
$VerbosePreference = 'Continue'

# Initialize logging
function Write-Log {
    param(
        [Parameter(Mandatory)]
        [string]$Message,

        [Parameter()]
        [ValidateSet('Info', 'Warning', 'Error', 'Success')]
        [string]$Level = 'Info'
    )

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $logMessage = "[$timestamp] [$Level] $Message"

    # Write to log file
    Add-Content -Path $LogPath -Value $logMessage -ErrorAction SilentlyContinue

    # Write to console with color
    switch ($Level) {
        'Info'    { Write-Host $logMessage -ForegroundColor Cyan }
        'Warning' { Write-Host $logMessage -ForegroundColor Yellow }
        'Error'   { Write-Host $logMessage -ForegroundColor Red }
        'Success' { Write-Host $logMessage -ForegroundColor Green }
    }
}

# Backup function
function Backup-EnvironmentVariables {
    param(
        [Parameter(Mandatory)]
        [string]$BackupDirectory
    )

    try {
        Write-Log "Creating backup of environment variables..." -Level Info

        # Create backup directory if it doesn't exist
        if (-not (Test-Path $BackupDirectory)) {
            New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
        }

        $backupFile = Join-Path $BackupDirectory "UserEnv_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"

        # Get all user environment variables
        $userEnv = @{}
        [System.Environment]::GetEnvironmentVariables([System.EnvironmentVariableTarget]::User).GetEnumerator() |
            ForEach-Object { $userEnv[$_.Key] = $_.Value }

        # Export to JSON
        $userEnv | ConvertTo-Json -Depth 10 | Set-Content -Path $backupFile -Encoding UTF8

        Write-Log "Backup created successfully: $backupFile" -Level Success
        return $backupFile
    }
    catch {
        Write-Log "Failed to create backup: $_" -Level Error
        throw
    }
}

# Restore function
function Restore-EnvironmentVariables {
    param(
        [Parameter(Mandatory)]
        [string]$BackupFile
    )

    try {
        if (-not (Test-Path $BackupFile)) {
            throw "Backup file not found: $BackupFile"
        }

        Write-Log "Restoring environment variables from: $BackupFile" -Level Info

        $backup = Get-Content $BackupFile -Raw | ConvertFrom-Json

        foreach ($key in $backup.PSObject.Properties.Name) {
            [System.Environment]::SetEnvironmentVariable($key, $backup.$key, [System.EnvironmentVariableTarget]::User)
        }

        Write-Log "Environment variables restored successfully" -Level Success
    }
    catch {
        Write-Log "Failed to restore backup: $_" -Level Error
        throw
    }
}

# Get standard Windows 11 user paths
function Get-StandardUserPaths {
    $userName = $env:USERNAME
    $userProfile = $env:USERPROFILE

    $standardPaths = @(
        "$userProfile\AppData\Local\Microsoft\WindowsApps",
        "$userProfile\AppData\Local\Programs\Python\Python312\Scripts",
        "$userProfile\AppData\Local\Programs\Python\Python312",
        "$userProfile\AppData\Local\Programs\Python\Python311\Scripts",
        "$userProfile\AppData\Local\Programs\Python\Python311",
        "$userProfile\AppData\Local\Programs\Python\Launcher",
        "$userProfile\.dotnet\tools",
        "$userProfile\AppData\Local\Programs\Microsoft VS Code\bin",
        "$userProfile\AppData\Local\Programs\Git\cmd",
        "$userProfile\AppData\Local\Programs\PowerShell\7",
        "$userProfile\AppData\Roaming\npm",
        "$userProfile\AppData\Local\Programs\nodejs",
        "${env:ProgramFiles}\PowerShell\7",
        "${env:ProgramFiles(x86)}\Windows Kits\10\Windows Performance Toolkit"
    )

    # Only return paths that actually exist
    return $standardPaths | Where-Object { Test-Path $_ }
}

# Clean PATH variable
function Clean-PathVariable {
    param(
        [Parameter()]
        [string]$PathVariable = 'Path',

        [Parameter()]
        [switch]$AddStandardPaths
    )

    try {
        Write-Log "Cleaning $PathVariable variable..." -Level Info

        # Get current PATH
        $currentPath = [System.Environment]::GetEnvironmentVariable($PathVariable, [System.EnvironmentVariableTarget]::User)

        if ([string]::IsNullOrWhiteSpace($currentPath)) {
            Write-Log "$PathVariable is empty or not set" -Level Warning
            $paths = @()
        }
        else {
            $paths = $currentPath -split ';' | Where-Object { $_ -ne '' }
        }

        Write-Log "Found $($paths.Count) paths in $PathVariable" -Level Info

        # Process paths
        $cleanedPaths = @()
        $removedPaths = @()
        $duplicates = @()

        foreach ($path in $paths) {
            $trimmedPath = $path.Trim()

            # Skip empty paths
            if ([string]::IsNullOrWhiteSpace($trimmedPath)) {
                continue
            }

            # Remove quotes if present
            $trimmedPath = $trimmedPath.Trim('"', "'")

            # Check for duplicates (case-insensitive)
            if ($cleanedPaths | Where-Object { $_ -eq $trimmedPath }) {
                $duplicates += $trimmedPath
                Write-Log "Duplicate path removed: $trimmedPath" -Level Warning
                continue
            }

            # Expand environment variables
            $expandedPath = [System.Environment]::ExpandEnvironmentVariables($trimmedPath)

            # Check if path exists
            if (Test-Path $expandedPath) {
                $cleanedPaths += $trimmedPath
            }
            else {
                $removedPaths += $trimmedPath
                Write-Log "Invalid path removed: $trimmedPath" -Level Warning
            }
        }

        # Add standard paths if requested
        if ($AddStandardPaths) {
            $standardPaths = Get-StandardUserPaths

            foreach ($stdPath in $standardPaths) {
                if ($cleanedPaths -notcontains $stdPath) {
                    $cleanedPaths += $stdPath
                    Write-Log "Added standard path: $stdPath" -Level Info
                }
            }
        }

        # Statistics
        Write-Log "Cleaning statistics:" -Level Info
        Write-Log "  Original paths: $($paths.Count)" -Level Info
        Write-Log "  Cleaned paths: $($cleanedPaths.Count)" -Level Info
        Write-Log "  Removed invalid: $($removedPaths.Count)" -Level Info
        Write-Log "  Removed duplicates: $($duplicates.Count)" -Level Info

        return $cleanedPaths
    }
    catch {
        Write-Log "Error cleaning PATH variable: $_" -Level Error
        throw
    }
}

# Clean other environment variables
function Clean-EnvironmentVariable {
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    try {
        $value = [System.Environment]::GetEnvironmentVariable($Name, [System.EnvironmentVariableTarget]::User)

        if ([string]::IsNullOrWhiteSpace($value)) {
            return $null
        }

        # Expand variables and check if path exists
        $expandedValue = [System.Environment]::ExpandEnvironmentVariables($value)

        # If it looks like a path, validate it
        if ($expandedValue -match '^[a-zA-Z]:\\' -or $expandedValue -match '^\\\\') {
            if (-not (Test-Path $expandedValue)) {
                Write-Log "Invalid path in $Name`: $value" -Level Warning
                return $null
            }
        }

        return $value
    }
    catch {
        Write-Log "Error cleaning variable $Name`: $_" -Level Error
        return $value
    }
}

# Main cleanup function
function Start-EnvironmentCleanup {
    try {
        Write-Log "=" * 60 -Level Info
        Write-Log "Starting Windows 11 User Environment Variables Cleanup" -Level Info
        Write-Log "=" * 60 -Level Info

        # Create backup unless skipped
        $backupFile = $null
        if (-not $SkipBackup) {
            $backupFile = Backup-EnvironmentVariables -BackupDirectory $BackupPath
        }

        # Clean PATH variable
        $cleanedPaths = Clean-PathVariable -PathVariable 'Path' -AddStandardPaths

        # Prepare new PATH string
        $newPath = $cleanedPaths -join ';'

        # Apply changes if not in WhatIf mode
        if ($PSCmdlet.ShouldProcess("User PATH Environment Variable", "Update")) {
            [System.Environment]::SetEnvironmentVariable('Path', $newPath, [System.EnvironmentVariableTarget]::User)
            Write-Log "PATH variable updated successfully" -Level Success
        }

        # Clean other common environment variables
        $commonVars = @(
            'TEMP',
            'TMP',
            'OneDrive',
            'OneDriveConsumer',
            'PYTHONPATH',
            'JAVA_HOME',
            'ANDROID_HOME',
            'NODE_PATH'
        )

        foreach ($varName in $commonVars) {
            $currentValue = [System.Environment]::GetEnvironmentVariable($varName, [System.EnvironmentVariableTarget]::User)

            if ($currentValue) {
                Write-Log "Checking $varName..." -Level Info
                $cleanedValue = Clean-EnvironmentVariable -Name $varName

                if ($cleanedValue -ne $currentValue) {
                    if ($PSCmdlet.ShouldProcess($varName, "Update environment variable")) {
                        if ($cleanedValue) {
                            [System.Environment]::SetEnvironmentVariable($varName, $cleanedValue, [System.EnvironmentVariableTarget]::User)
                            Write-Log "$varName updated" -Level Success
                        }
                        else {
                            [System.Environment]::SetEnvironmentVariable($varName, $null, [System.EnvironmentVariableTarget]::User)
                            Write-Log "$varName removed (invalid)" -Level Warning
                        }
                    }
                }
            }
        }

        # Set/Update common missing variables
        $defaultVars = @{
            'TEMP' = "$env:USERPROFILE\AppData\Local\Temp"
            'TMP' = "$env:USERPROFILE\AppData\Local\Temp"
        }

        foreach ($key in $defaultVars.Keys) {
            $currentValue = [System.Environment]::GetEnvironmentVariable($key, [System.EnvironmentVariableTarget]::User)

            if (-not $currentValue) {
                if ($PSCmdlet.ShouldProcess($key, "Set default environment variable")) {
                    [System.Environment]::SetEnvironmentVariable($key, $defaultVars[$key], [System.EnvironmentVariableTarget]::User)
                    Write-Log "Set default value for $key" -Level Info
                }
            }
        }

        Write-Log "=" * 60 -Level Info
        Write-Log "Environment cleanup completed successfully!" -Level Success
        Write-Log "Backup saved to: $backupFile" -Level Info
        Write-Log "Log file: $LogPath" -Level Info
        Write-Log "=" * 60 -Level Info

        # Prompt for system refresh
        if (-not $WhatIfPreference) {
            Write-Host "`nIMPORTANT: You may need to:" -ForegroundColor Yellow
            Write-Host "1. Close and reopen any command prompts or PowerShell windows" -ForegroundColor Yellow
            Write-Host "2. Log out and log back in for all changes to take effect" -ForegroundColor Yellow
            Write-Host "3. Some applications may need to be restarted" -ForegroundColor Yellow

            if ($backupFile) {
                Write-Host "`nTo restore previous settings, run:" -ForegroundColor Cyan
                Write-Host "  .\Fix-UserEnvironmentPaths.ps1 -RestoreBackup '$backupFile'" -ForegroundColor White
            }
        }
    }
    catch {
        Write-Log "Critical error during cleanup: $_" -Level Error

        if ($backupFile -and (Test-Path $backupFile)) {
            Write-Log "Attempting to restore from backup..." -Level Warning

            try {
                Restore-EnvironmentVariables -BackupFile $backupFile
                Write-Log "Successfully restored from backup" -Level Success
            }
            catch {
                Write-Log "Failed to restore from backup: $_" -Level Error
                Write-Log "Manual restore may be required from: $backupFile" -Level Error
            }
        }

        throw
    }
}

# Validation function
function Test-EnvironmentHealth {
    Write-Log "Running environment health check..." -Level Info

    $issues = @()

    # Check PATH variable
    $path = [System.Environment]::GetEnvironmentVariable('Path', [System.EnvironmentVariableTarget]::User)

    if ([string]::IsNullOrWhiteSpace($path)) {
        $issues += "PATH variable is empty or not set"
    }
    else {
        $paths = $path -split ';'
        $invalidPaths = @()

        foreach ($p in $paths) {
            if (-not [string]::IsNullOrWhiteSpace($p)) {
                $expanded = [System.Environment]::ExpandEnvironmentVariables($p.Trim())
                if (-not (Test-Path $expanded)) {
                    $invalidPaths += $p
                }
            }
        }

        if ($invalidPaths.Count -gt 0) {
            $issues += "Found $($invalidPaths.Count) invalid paths in PATH variable"
        }
    }

    # Check TEMP/TMP
    foreach ($var in @('TEMP', 'TMP')) {
        $value = [System.Environment]::GetEnvironmentVariable($var, [System.EnvironmentVariableTarget]::User)

        if ($value) {
            $expanded = [System.Environment]::ExpandEnvironmentVariables($value)
            if (-not (Test-Path $expanded)) {
                $issues += "$var points to non-existent directory: $value"
            }
        }
    }

    if ($issues.Count -eq 0) {
        Write-Log "Environment health check passed!" -Level Success
        return $true
    }
    else {
        Write-Log "Environment health check found issues:" -Level Warning
        foreach ($issue in $issues) {
            Write-Log "  - $issue" -Level Warning
        }
        return $false
    }
}

# Main execution
try {
    # Check if running with administrator privileges
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")

    if (-not $isAdmin) {
        Write-Warning "This script is running without administrator privileges."
        Write-Warning "Some environment variables may not be accessible or modifiable."
        Write-Host ""

        if (-not $Force) {
            $response = Read-Host "Do you want to continue anyway? (Y/N)"
            if ($response -ne 'Y' -and $response -ne 'y') {
                Write-Log "Script execution cancelled by user" -Level Info
                exit 0
            }
        }
    }

    # Check Windows version
    $osVersion = [System.Environment]::OSVersion.Version
    if ($osVersion.Major -lt 10 -or ($osVersion.Major -eq 10 -and $osVersion.Build -lt 22000)) {
        Write-Warning "This script is optimized for Windows 11 (Build 22000+)"
        Write-Warning "Current OS: Windows $($osVersion.Major) Build $($osVersion.Build)"

        if (-not $Force) {
            $response = Read-Host "Do you want to continue? (Y/N)"
            if ($response -ne 'Y' -and $response -ne 'y') {
                Write-Log "Script execution cancelled - incompatible OS version" -Level Info
                exit 0
            }
        }
    }

    # Run initial health check
    Write-Host "`nRunning initial environment health check..." -ForegroundColor Cyan
    $initialHealth = Test-EnvironmentHealth

    if ($initialHealth) {
        Write-Host "Environment appears healthy. Running cleanup anyway..." -ForegroundColor Green
    }
    else {
        Write-Host "Environment issues detected. Proceeding with cleanup..." -ForegroundColor Yellow
    }

    # Run cleanup
    Start-EnvironmentCleanup

    # Run final health check
    Write-Host "`nRunning final environment health check..." -ForegroundColor Cyan
    $finalHealth = Test-EnvironmentHealth

    if ($finalHealth) {
        Write-Host "`nEnvironment cleanup completed successfully!" -ForegroundColor Green
    }
    else {
        Write-Host "`nEnvironment cleanup completed with warnings. Check the log for details." -ForegroundColor Yellow
    }
}
catch {
    Write-Error "Script execution failed: $_"
    Write-Host "`nCheck the log file for details: $LogPath" -ForegroundColor Red
    exit 1
}

# Script completion
Write-Host "`nScript execution completed. Log saved to: $LogPath" -ForegroundColor Cyan
exit 0
