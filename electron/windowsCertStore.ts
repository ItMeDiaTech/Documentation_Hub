import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import * as crypto from 'crypto';

const execAsync = promisify(exec);

/**
 * Windows Certificate Store Integration
 * Provides methods to interact with Windows certificate store for automatic
 * Zscaler and corporate certificate discovery
 */
export class WindowsCertStore {
  private certificateCache: Map<string, string> = new Map();
  private readonly tempCertDir: string;

  constructor() {
    this.tempCertDir = path.join(app.getPath('userData'), 'certs');
    this.ensureCertDirectory();
  }

  /**
   * Ensure certificate directory exists
   */
  private ensureCertDirectory(): void {
    if (!fs.existsSync(this.tempCertDir)) {
      fs.mkdirSync(this.tempCertDir, { recursive: true });
      console.log('[WindowsCertStore] Created certificate directory:', this.tempCertDir);
    }
  }

  /**
   * Search for Zscaler certificate in Windows certificate store
   */
  public async findZscalerCertificate(): Promise<string | null> {
    if (process.platform !== 'win32') {
      console.log('[WindowsCertStore] Not on Windows, skipping certificate store search');
      return null;
    }

    console.log('[WindowsCertStore] Searching for Zscaler certificate in Windows store...');

    try {
      // PowerShell script to find and export Zscaler certificate
      const psScript = `
        $ErrorActionPreference = 'Stop'

        # Search in multiple certificate stores
        $stores = @('Root', 'CA', 'AuthRoot', 'Trust', 'My')
        $zscalerCert = $null

        foreach ($storeName in $stores) {
          try {
            $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, 'LocalMachine')
            $store.Open('ReadOnly')

            # Look for certificates with Zscaler in the subject or issuer
            $certs = $store.Certificates | Where-Object {
              $_.Subject -like '*Zscaler*' -or
              $_.Issuer -like '*Zscaler*' -or
              $_.FriendlyName -like '*Zscaler*'
            }

            if ($certs) {
              $zscalerCert = $certs[0]
              Write-Host "FOUND:$storeName"
              Write-Host "SUBJECT:$($zscalerCert.Subject)"
              Write-Host "ISSUER:$($zscalerCert.Issuer)"
              Write-Host "THUMBPRINT:$($zscalerCert.Thumbprint)"
              Write-Host "NOTAFTER:$($zscalerCert.NotAfter)"

              # Export certificate to Base64
              $base64 = [System.Convert]::ToBase64String($zscalerCert.RawData)
              Write-Host "-----BEGIN CERTIFICATE-----"
              # Output in 64-character lines
              for ($i = 0; $i -lt $base64.Length; $i += 64) {
                $length = [Math]::Min(64, $base64.Length - $i)
                Write-Host $base64.Substring($i, $length)
              }
              Write-Host "-----END CERTIFICATE-----"

              $store.Close()
              exit 0
            }

            $store.Close()
          } catch {
            # Continue to next store
          }
        }

        # Also check CurrentUser stores
        foreach ($storeName in $stores) {
          try {
            $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, 'CurrentUser')
            $store.Open('ReadOnly')

            $certs = $store.Certificates | Where-Object {
              $_.Subject -like '*Zscaler*' -or
              $_.Issuer -like '*Zscaler*' -or
              $_.FriendlyName -like '*Zscaler*'
            }

            if ($certs) {
              $zscalerCert = $certs[0]
              Write-Host "FOUND:$storeName (CurrentUser)"
              Write-Host "SUBJECT:$($zscalerCert.Subject)"
              Write-Host "ISSUER:$($zscalerCert.Issuer)"
              Write-Host "THUMBPRINT:$($zscalerCert.Thumbprint)"
              Write-Host "NOTAFTER:$($zscalerCert.NotAfter)"

              # Export certificate to Base64
              $base64 = [System.Convert]::ToBase64String($zscalerCert.RawData)
              Write-Host "-----BEGIN CERTIFICATE-----"
              for ($i = 0; $i -lt $base64.Length; $i += 64) {
                $length = [Math]::Min(64, $base64.Length - $i)
                Write-Host $base64.Substring($i, $length)
              }
              Write-Host "-----END CERTIFICATE-----"

              $store.Close()
              exit 0
            }

            $store.Close()
          } catch {
            # Continue
          }
        }

        Write-Host "NOTFOUND:No Zscaler certificate found in Windows stores"
        exit 1
      `.replace(/\n/g, ' ');

      const { stdout } = await execAsync(
        `powershell -NoProfile -NonInteractive -Command "${psScript}"`,
        { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer for certificate data
      );

      // Parse the output
      if (stdout.includes('-----BEGIN CERTIFICATE-----')) {
        console.log('[WindowsCertStore] Found Zscaler certificate in Windows store');

        // Extract certificate info
        const lines = stdout.split('\n');
        let certInfo: any = {};
        let certPEM = '';
        let inCert = false;

        for (const line of lines) {
          if (line.startsWith('FOUND:')) {
            certInfo.store = line.substring(6).trim();
          } else if (line.startsWith('SUBJECT:')) {
            certInfo.subject = line.substring(8).trim();
          } else if (line.startsWith('ISSUER:')) {
            certInfo.issuer = line.substring(7).trim();
          } else if (line.startsWith('THUMBPRINT:')) {
            certInfo.thumbprint = line.substring(11).trim();
          } else if (line.startsWith('NOTAFTER:')) {
            certInfo.notAfter = line.substring(9).trim();
          } else if (line.includes('-----BEGIN CERTIFICATE-----')) {
            inCert = true;
            certPEM += line + '\n';
          } else if (line.includes('-----END CERTIFICATE-----')) {
            certPEM += line + '\n';
            inCert = false;
          } else if (inCert) {
            certPEM += line.trim() + '\n';
          }
        }

        console.log('[WindowsCertStore] Certificate info:', certInfo);

        // Save certificate to file
        const certPath = path.join(this.tempCertDir, 'zscaler-root.pem');
        fs.writeFileSync(certPath, certPEM);
        console.log('[WindowsCertStore] Saved certificate to:', certPath);

        // Cache the certificate
        this.certificateCache.set('zscaler', certPath);

        return certPath;
      } else {
        console.log('[WindowsCertStore] No Zscaler certificate found in Windows store');
        return null;
      }
    } catch (error) {
      console.error('[WindowsCertStore] Error searching for certificate:', error);
      return null;
    }
  }

  /**
   * Export all trusted root certificates from Windows store
   */
  public async exportTrustedRootCertificates(): Promise<string | null> {
    if (process.platform !== 'win32') {
      return null;
    }

    console.log('[WindowsCertStore] Exporting trusted root certificates...');

    try {
      const psScript = `
        $ErrorActionPreference = 'Stop'

        # Get all certificates from Root store
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
        $store.Open('ReadOnly')

        $certCount = 0

        foreach ($cert in $store.Certificates) {
          # Only export certificates that are currently valid
          if ($cert.NotAfter -gt (Get-Date) -and $cert.NotBefore -lt (Get-Date)) {
            $base64 = [System.Convert]::ToBase64String($cert.RawData)
            Write-Host "-----BEGIN CERTIFICATE-----"
            for ($i = 0; $i -lt $base64.Length; $i += 64) {
              $length = [Math]::Min(64, $base64.Length - $i)
              Write-Host $base64.Substring($i, $length)
            }
            Write-Host "-----END CERTIFICATE-----"
            $certCount++
          }
        }

        $store.Close()
        Write-Host "EXPORTED:$certCount certificates"
      `.replace(/\n/g, ' ');

      const { stdout } = await execAsync(
        `powershell -NoProfile -NonInteractive -Command "${psScript}"`,
        { maxBuffer: 50 * 1024 * 1024 } // 50MB buffer for all certificates
      );

      if (stdout.includes('-----BEGIN CERTIFICATE-----')) {
        // Save bundle to file
        const bundlePath = path.join(this.tempCertDir, 'windows-ca-bundle.pem');

        // Extract just the certificates
        const certLines = stdout.split('\n');
        let bundle = '';
        let inCert = false;

        for (const line of certLines) {
          if (line.includes('-----BEGIN CERTIFICATE-----')) {
            inCert = true;
            bundle += line + '\n';
          } else if (line.includes('-----END CERTIFICATE-----')) {
            bundle += line + '\n';
            inCert = false;
          } else if (inCert) {
            bundle += line.trim() + '\n';
          }
        }

        fs.writeFileSync(bundlePath, bundle);
        console.log('[WindowsCertStore] Exported Windows CA bundle to:', bundlePath);

        return bundlePath;
      }

      return null;
    } catch (error) {
      console.error('[WindowsCertStore] Error exporting certificates:', error);
      return null;
    }
  }

  /**
   * Find certificate by thumbprint
   */
  public async findCertificateByThumbprint(thumbprint: string): Promise<string | null> {
    if (process.platform !== 'win32') {
      return null;
    }

    // Check cache first
    if (this.certificateCache.has(thumbprint)) {
      return this.certificateCache.get(thumbprint)!;
    }

    try {
      const psScript = `
        $cert = Get-ChildItem -Path Cert:\\LocalMachine\\Root,Cert:\\LocalMachine\\CA,Cert:\\CurrentUser\\Root,Cert:\\CurrentUser\\CA -Recurse |
          Where-Object { $_.Thumbprint -eq '${thumbprint}' } |
          Select-Object -First 1

        if ($cert) {
          $base64 = [System.Convert]::ToBase64String($cert.RawData)
          Write-Host "-----BEGIN CERTIFICATE-----"
          for ($i = 0; $i -lt $base64.Length; $i += 64) {
            $length = [Math]::Min(64, $base64.Length - $i)
            Write-Host $base64.Substring($i, $length)
          }
          Write-Host "-----END CERTIFICATE-----"
        }
      `.replace(/\n/g, ' ');

      const { stdout } = await execAsync(
        `powershell -NoProfile -NonInteractive -Command "${psScript}"`
      );

      if (stdout.includes('-----BEGIN CERTIFICATE-----')) {
        const certPath = path.join(this.tempCertDir, `cert-${thumbprint}.pem`);
        fs.writeFileSync(certPath, stdout.trim());
        this.certificateCache.set(thumbprint, certPath);
        return certPath;
      }

      return null;
    } catch (error) {
      console.error('[WindowsCertStore] Error finding certificate by thumbprint:', error);
      return null;
    }
  }

  /**
   * Check if running with elevated privileges (might be needed for some cert operations)
   */
  public async checkElevation(): Promise<boolean> {
    if (process.platform !== 'win32') {
      return false;
    }

    try {
      const { stdout } = await execAsync(
        'powershell -Command "[Security.Principal.WindowsIdentity]::GetCurrent().Groups -contains \\"S-1-5-32-544\\""'
      );
      return stdout.trim().toLowerCase() === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Get certificate info from a PEM file
   */
  public getCertificateInfo(pemPath: string): any {
    try {
      const pemContent = fs.readFileSync(pemPath, 'utf8');
      const lines = pemContent.split('\n');

      // Basic parsing - in production you'd use a proper X.509 parser
      const info = {
        path: pemPath,
        exists: true,
        size: fs.statSync(pemPath).size,
        hash: crypto.createHash('sha256').update(pemContent).digest('hex')
      };

      return info;
    } catch (error) {
      return null;
    }
  }

  /**
   * Create a combined certificate bundle
   */
  public async createCombinedBundle(additionalCerts: string[] = []): Promise<string | null> {
    try {
      const bundlePath = path.join(this.tempCertDir, 'combined-ca-bundle.pem');
      let combinedBundle = '';

      // Add Windows trusted roots
      const windowsBundle = await this.exportTrustedRootCertificates();
      if (windowsBundle && fs.existsSync(windowsBundle)) {
        combinedBundle += fs.readFileSync(windowsBundle, 'utf8') + '\n';
      }

      // Add Zscaler certificate
      const zscalerCert = await this.findZscalerCertificate();
      if (zscalerCert && fs.existsSync(zscalerCert)) {
        combinedBundle += fs.readFileSync(zscalerCert, 'utf8') + '\n';
      }

      // Add any additional certificates
      for (const certPath of additionalCerts) {
        if (fs.existsSync(certPath)) {
          combinedBundle += fs.readFileSync(certPath, 'utf8') + '\n';
        }
      }

      if (combinedBundle) {
        fs.writeFileSync(bundlePath, combinedBundle);
        console.log('[WindowsCertStore] Created combined certificate bundle:', bundlePath);
        return bundlePath;
      }

      return null;
    } catch (error) {
      console.error('[WindowsCertStore] Error creating combined bundle:', error);
      return null;
    }
  }

  /**
   * Clean up old certificate files
   */
  public cleanupOldCertificates(daysOld: number = 7): void {
    try {
      const now = Date.now();
      const files = fs.readdirSync(this.tempCertDir);

      for (const file of files) {
        const filePath = path.join(this.tempCertDir, file);
        const stats = fs.statSync(filePath);
        const age = (now - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

        if (age > daysOld) {
          fs.unlinkSync(filePath);
          console.log(`[WindowsCertStore] Cleaned up old certificate: ${file}`);
        }
      }
    } catch (error) {
      console.error('[WindowsCertStore] Error cleaning up certificates:', error);
    }
  }
}

// Export singleton instance
export const windowsCertStore = new WindowsCertStore();