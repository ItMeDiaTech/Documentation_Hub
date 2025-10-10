# Network & TLS Diagnostic Tests for Documentation Hub

Run these tests in order and copy the output. This will help identify the exact cause of your TLS/network issues.

## Prerequisites

- Run PowerShell as regular user (no admin required)
- Have your Documentation Hub application closed
- Copy each command exactly as shown

**Note:** All tests have been modified to work WITHOUT administrator privileges.

---

## 1. PowerShell Network Tests

### Test 1.1: Basic PowerShell Download from GitHub

```powershell
# Test if PowerShell can download from GitHub at all
$ProgressPreference = 'SilentlyContinue'
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $response = Invoke-WebRequest -Uri "https://api.github.com/repos/ItMeDiaTech/Documentation_Hub/releases/latest" -UseBasicParsing
    Write-Host "SUCCESS: Connected to GitHub API"
    Write-Host "Status Code: $($response.StatusCode)"
} catch {
    Write-Host "FAILED: $($_.Exception.Message)"
    Write-Host "Inner Exception: $($_.Exception.InnerException)"
}
```

### Test 1.2: PowerShell with System Proxy

```powershell
# Test with system proxy explicitly
try {
    $proxy = [System.Net.WebRequest]::GetSystemWebProxy()
    $proxyUri = $proxy.GetProxy("https://github.com")
    Write-Host "System Proxy for GitHub: $proxyUri"

    $webclient = New-Object System.Net.WebClient
    $webclient.UseDefaultCredentials = $true
    $webclient.Proxy = $proxy
    $webclient.Proxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials

    $result = $webclient.DownloadString("https://api.github.com")
    Write-Host "SUCCESS: Downloaded with system proxy"
} catch {
    Write-Host "FAILED with proxy: $($_.Exception.Message)"
}
```

### Test 1.3: PowerShell Certificate Callback Test

```powershell
# Test with certificate validation callback
[Net.ServicePointManager]::ServerCertificateValidationCallback = {
    param($sender, $cert, $chain, $errors)
    Write-Host "Certificate Subject: $($cert.Subject)"
    Write-Host "Certificate Issuer: $($cert.Issuer)"
    Write-Host "Errors: $errors"
    return $true
}

try {
    $response = Invoke-WebRequest -Uri "https://github.com" -UseBasicParsing
    Write-Host "SUCCESS with cert callback"
} catch {
    Write-Host "FAILED even with cert callback: $_"
}

# Reset callback
[Net.ServicePointManager]::ServerCertificateValidationCallback = $null
```

---

## 2. Certificate Store Diagnostics

### Test 2.1: List Client Certificates

```powershell
# Show all client certificates that could be used for mutual TLS
Get-ChildItem Cert:\CurrentUser\My | Format-Table Subject, Issuer, NotAfter -AutoSize
Get-ChildItem Cert:\LocalMachine\My | Format-Table Subject, Issuer, NotAfter -AutoSize
```

### Test 2.2: Check for EAP-TLS Certificates

```powershell
# Look for EAP-TLS related certificates
Get-ChildItem Cert:\CurrentUser\My | Where-Object {
    $_.EnhancedKeyUsageList -like "*Client Authentication*"
} | Format-List Subject, Issuer, EnhancedKeyUsageList
```

### Test 2.3: Machine Certificate Check (No Admin)

```powershell
# Check machine certificates (readable without admin)
try {
    $certs = Get-ChildItem Cert:\LocalMachine\My -ErrorAction SilentlyContinue
    if ($certs) {
        Write-Host "Total Machine Certificates visible: $($certs.Count)"
        $certs | Select-Object Subject, Issuer, Thumbprint -First 5 | Format-Table -AutoSize
    } else {
        Write-Host "Cannot read machine certificates (may need admin)"
    }
} catch {
    Write-Host "Machine certificate store not accessible: $_"
}

# Check your user certificates instead
$userCerts = Get-ChildItem Cert:\CurrentUser\My
Write-Host "`nUser Certificates: $($userCerts.Count)"
$userCerts | Select-Object Subject, Issuer, NotAfter | Format-Table -AutoSize
```

---

## 3. Proxy Configuration Tests

### Test 3.1: Check System Proxy Settings

```powershell
# Get Windows proxy configuration
netsh winhttp show proxy
```

### Test 3.2: Check Environment Variables

```powershell
# Show proxy-related environment variables
Get-ChildItem env: | Where-Object {$_.Name -like "*PROXY*" -or $_.Name -like "*proxy*"} | Format-Table Name, Value -AutoSize
Get-ChildItem env: | Where-Object {$_.Name -like "*CERT*"} | Format-Table Name, Value -AutoSize
```

### Test 3.3: Check Internet Options Proxy

```powershell
# Check Internet Explorer proxy settings (affects many Windows apps)
Get-ItemProperty -Path "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Internet Settings" | Select-Object ProxyEnable, ProxyServer, ProxyOverride, AutoConfigURL
```

### Test 3.4: Test localhost:8005 Connection

```powershell
# Check if localhost:8005 is listening
Test-NetConnection -ComputerName localhost -Port 8005
```

---

## 4. Network Configuration

### Test 4.1: Show Network Adapters with 802.1X

```powershell
# Show network adapter authentication (may work without admin)
try {
    netsh lan show profiles 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "LAN profiles require admin privileges"
    }
} catch {
    Write-Host "Cannot show LAN profiles: $_"
}

# WLAN profiles usually work without admin
netsh wlan show profiles

# Alternative: Get network adapter info
Get-NetAdapter | Select-Object Name, Status, MediaType, LinkSpeed | Format-Table -AutoSize
```

### Test 4.2: Check Active Connections

```powershell
# Show current connections and listening ports
netstat -an | findstr ":8005"
netstat -an | findstr ":8080"
netstat -an | findstr "ESTABLISHED"
```

### Test 4.3: DNS Resolution Test

```powershell
# Test DNS resolution for GitHub
Resolve-DnsName github.com
Resolve-DnsName api.github.com
Resolve-DnsName objects.githubusercontent.com
```

---

## 5. TLS/SSL Testing

### Test 5.1: OpenSSL TLS Test (if available)

```bash
# If you have OpenSSL or Git Bash:
openssl s_client -connect github.com:443 -tls1_2
```

### Test 5.2: Test TLS with curl (if available)

```bash
# In Git Bash or if curl is installed:
curl -v https://api.github.com/repos/ItMeDiaTech/Documentation_Hub/releases/latest 2>&1 | head -50
```

### Test 5.3: PowerShell TLS Cipher Test

```powershell
# Show supported TLS protocols
[Net.ServicePointManager]::SecurityProtocol
[Enum]::GetNames([Net.SecurityProtocolType])
```

---

## 6. GitHub-Specific Tests

### Test 6.1: Test Different GitHub URLs

```powershell
$urls = @(
    "https://github.com",
    "https://api.github.com",
    "https://raw.githubusercontent.com",
    "https://objects.githubusercontent.com"
)

foreach ($url in $urls) {
    try {
        $response = Invoke-WebRequest -Uri $url -Method HEAD -UseBasicParsing -TimeoutSec 5
        Write-Host "✓ $url - Status: $($response.StatusCode)"
    } catch {
        Write-Host "✗ $url - Error: $($_.Exception.Message)"
    }
}
```

### Test 6.2: GitHub API with Token (Optional)

```powershell
# If you have a GitHub token, test authenticated request
$token = "ghp_YOUR_TOKEN_HERE"  # Replace with your token if available
$headers = @{
    "Authorization" = "Bearer $token"
    "Accept" = "application/vnd.github.v3+json"
}
try {
    $response = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers
    Write-Host "Authenticated as: $($response.login)"
} catch {
    Write-Host "Auth failed: $_"
}
```

---

## 7. MSDTC and Network Service Tests

### Test 7.1: Check MSDTC Configuration (Non-Admin)

```powershell
# Try to check MSDTC settings (may require admin)
try {
    Get-DtcNetworkSetting -ErrorAction SilentlyContinue | Format-List
} catch {
    Write-Host "MSDTC settings require admin privileges"
    Write-Host "Checking registry instead..."

    # Try to read MSDTC settings from registry (sometimes readable)
    try {
        $msdtc = Get-ItemProperty -Path "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\MSDTC\Security" -ErrorAction SilentlyContinue
        if ($msdtc) {
            Write-Host "MSDTC Registry Settings Found:"
            $msdtc | Format-List NetworkDtcAccess*, XaTransactions*, LuTransactions*
        }
    } catch {
        Write-Host "Cannot read MSDTC registry: $_"
    }
}

# Check if MSDTC service is running
Get-Service MSDTC | Select-Object Name, Status, StartType
```

### Test 7.2: Check Windows Services Using Mutual Auth

```powershell
# List services running as NetworkService
Get-WmiObject Win32_Service | Where-Object {$_.StartName -eq "NT AUTHORITY\NetworkService"} | Select-Object Name, State, StartMode | Format-Table -AutoSize
```

---

## 8. Event Log Analysis

### Test 8.1: Recent Security Events (Non-Admin)

```powershell
# Try to check security events (often requires admin)
try {
    Get-EventLog -LogName Security -Newest 5 -ErrorAction Stop | Format-Table TimeGenerated, EntryType, Message -AutoSize
} catch {
    Write-Host "Security log requires admin privileges: $_"
    Write-Host "Skipping security event log check"
}
```

### Test 8.2: System and Application Events

```powershell
# Check system log for network errors (sometimes accessible)
try {
    Get-EventLog -LogName System -Newest 20 -ErrorAction SilentlyContinue |
        Where-Object {$_.Message -like "*TLS*" -or $_.Message -like "*certificate*" -or $_.Message -like "*8005*" -or $_.Message -like "*network*"} |
        Select-Object TimeGenerated, EntryType, Source, Message -First 5 | Format-List
} catch {
    Write-Host "Cannot read System log: $_"
}

# Application log is usually readable
Write-Host "`nChecking Application log for network/TLS errors..."
Get-EventLog -LogName Application -Newest 50 |
    Where-Object {$_.Source -like "*Electron*" -or $_.Source -like "*Chrome*" -or $_.Message -like "*TLS*" -or $_.Message -like "*certificate*"} |
    Select-Object TimeGenerated, Source, Message -First 5 | Format-List
```

---

## 9. Node.js/Electron Tests

### Test 9.1: Node.js HTTPS Test

Save this as `test-node.js` and run with `node test-node.js`:

```javascript
const https = require('https');

console.log('Testing Node.js HTTPS to GitHub...');
console.log('NODE_TLS_REJECT_UNAUTHORIZED:', process.env.NODE_TLS_REJECT_UNAUTHORIZED);

https
  .get(
    'https://api.github.com/repos/ItMeDiaTech/Documentation_Hub/releases/latest',
    {
      headers: { 'User-Agent': 'Node.js Test' },
    },
    (res) => {
      console.log('SUCCESS: Status Code:', res.statusCode);
      console.log('Headers:', res.headers);
    }
  )
  .on('error', (err) => {
    console.error('FAILED:', err.message);
    console.error('Code:', err.code);
    console.error('Stack:', err.stack);
  });
```

### Test 9.2: Check Node.js Certificate Store

```javascript
// Save as test-certs.js and run
const tls = require('tls');
console.log('Node.js TLS Ciphers:', tls.getCiphers().length, 'available');
console.log(
  'Default CA Store:',
  tls.rootCertificates ? tls.rootCertificates.length : 'Not accessible'
);
```

---

## 10. Comprehensive Connection Test

### Test 10.1: Full PowerShell Download Test

```powershell
# Complete test mimicking what the updater does
$testUrl = "https://github.com/ItMeDiaTech/Documentation_Hub/releases/download/v1.0.37/latest.yml"
$tempFile = "$env:TEMP\test-download.yml"

Write-Host "Testing full download process..."
Write-Host "URL: $testUrl"
Write-Host "Destination: $tempFile"

# Configure like the app does
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::Expect100Continue = $false
[Net.ServicePointManager]::DefaultConnectionLimit = 10

try {
    $webclient = New-Object System.Net.WebClient
    $webclient.UseDefaultCredentials = $true

    # Set proxy
    $proxy = [System.Net.WebRequest]::GetSystemWebProxy()
    $webclient.Proxy = $proxy
    $webclient.Proxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials

    # Add headers
    $webclient.Headers.Add("User-Agent", "DocumentationHub/1.0.37")
    $webclient.Headers.Add("Accept", "application/octet-stream, application/yaml, */*")

    # Show configuration
    Write-Host "Proxy for URL: $($proxy.GetProxy($testUrl))"

    # Attempt download
    $webclient.DownloadFile($testUrl, $tempFile)

    if (Test-Path $tempFile) {
        $size = (Get-Item $tempFile).Length
        Write-Host "SUCCESS: Downloaded $size bytes"
        Remove-Item $tempFile
    }
} catch {
    Write-Host "FAILED: $($_.Exception.GetType().FullName)"
    Write-Host "Message: $($_.Exception.Message)"
    if ($_.Exception.InnerException) {
        Write-Host "Inner: $($_.Exception.InnerException.Message)"
    }
}
```

---

## Additional Non-Admin Network Tests

### Test 11.1: Check Windows Defender Firewall Status

```powershell
# Check if Windows Firewall might be blocking
Get-NetFirewallProfile | Select-Object Name, Enabled | Format-Table -AutoSize

# Check for GitHub-related firewall rules (readable without admin)
Get-NetFirewallRule -ErrorAction SilentlyContinue |
    Where-Object {$_.DisplayName -like "*git*" -or $_.DisplayName -like "*electron*" -or $_.DisplayName -like "*node*"} |
    Select-Object DisplayName, Enabled, Direction, Action -First 10 | Format-Table -AutoSize
```

### Test 11.2: User Environment Check

```powershell
# Get all environment variables that might affect networking
Write-Host "User Environment Variables:"
[Environment]::GetEnvironmentVariables("User") | Format-Table -AutoSize

Write-Host "`nHTTP/HTTPS Related Variables:"
Get-ChildItem env: | Where-Object {
    $_.Name -match "PROXY|HTTP|CERT|SSL|TLS|NODE|NPM|GIT"
} | Sort-Object Name | Format-Table Name, Value -AutoSize
```

### Test 11.3: Check Group Policy Network Settings

```powershell
# Try to check group policy settings (some readable without admin)
try {
    gpresult /Scope User /v | Select-String -Pattern "proxy|certificate|TLS|802.1x|network" -Context 1,1
} catch {
    Write-Host "Cannot read group policy: $_"
}
```

---

## How to Run These Tests

1. Open PowerShell as **regular user** (NO admin needed)
2. Copy and run each test command
3. Save the output from each test
4. Note any error messages, especially:
   - Certificate subjects/issuers
   - Specific error codes
   - Proxy URLs detected
   - Which URLs work vs fail

## What to Look For

### 🔴 Red Flags

- "The underlying connection was closed"
- "Could not establish trust relationship"
- "Unable to connect to the remote server"
- Certificate issuer contains company name (not GitHub/DigiCert)
- Proxy shows localhost:8005 or similar
- MSDTC shows "Mutual Authentication Required"

### 🟢 Good Signs

- PowerShell can download from GitHub
- Certificates show "DigiCert" or "GitHub" as issuer
- No proxy or direct connection to GitHub
- DNS resolves to public IPs (not internal)

## Provide Results

After running these tests, provide:

1. The test number and name
2. Whether it succeeded or failed
3. Any error messages
4. Any unusual output (like company certificates, internal IPs, etc.)

### Priority Tests (Run These First!)

These are the MOST important tests for diagnosing your issue:

1. **Test 1.1** - Basic PowerShell Download (shows if PowerShell can connect at all)
2. **Test 1.2** - System Proxy Test (reveals proxy configuration)
3. **Test 2.1 & 2.2** - Certificate listing (shows available client certificates)
4. **Test 3.3** - Internet Options Proxy (shows IE proxy which affects many Windows apps)
5. **Test 3.4** - localhost:8005 check (confirms if WSUS/MSDTC proxy is active)
6. **Test 10.1** - Full Download Test (simulates exactly what the app does)

### What Tests Can't Run Without Admin

These tests will show limited info without admin:

- MSDTC configuration details (Test 7.1)
- Security event log (Test 8.1)
- Some network adapter details (Test 4.1)
- NetworkService certificate permissions (original Test 2.3)

However, the alternative commands provided will still give us useful information!

This will help identify the exact layer where the connection is failing.
