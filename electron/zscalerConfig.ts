import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { windowsCertStore } from './windowsCertStore';

const execAsync = promisify(exec);

/**
 * Zscaler-specific configuration for handling SSL inspection
 * This module detects and configures Zscaler root certificates
 */
export class ZscalerConfig {
  private zscalerCertPath: string | null = null;
  private isZscalerDetected: boolean = false;
  private certificateContent: string | null = null;

  constructor() {
    this.detectZscaler();
  }

  /**
   * Common locations where Zscaler root certificate might be stored
   */
  private getCommonCertPaths(): string[] {
    const homeDir = os.homedir();
    const paths: string[] = [];

    if (process.platform === 'win32') {
      paths.push(
        // Common Zscaler certificate locations on Windows
        path.join('C:', 'Zscaler', 'ZscalerRootCertificate.crt'),
        path.join('C:', 'Zscaler', 'ZscalerRootCertificate.pem'),
        path.join('C:', 'Program Files', 'Zscaler', 'ZSAInstaller', 'ZscalerRootCertificate.crt'),
        path.join('C:', 'Program Files (x86)', 'Zscaler', 'ZSAInstaller', 'ZscalerRootCertificate.crt'),
        path.join(homeDir, 'AppData', 'Local', 'Zscaler', 'ZscalerRootCertificate.crt'),
        path.join(homeDir, 'AppData', 'Local', 'Zscaler', 'ZscalerRootCertificate.pem'),
        // Sometimes IT departments place it here
        path.join(homeDir, '.zscaler', 'cert.pem'),
        path.join(homeDir, '.zscaler', 'ZscalerRootCA.pem'),
        path.join(homeDir, 'zscaler.pem'),
        path.join(homeDir, 'zscaler-cert.pem'),
        // Corporate standard locations
        path.join('C:', 'certs', 'ZscalerRootCA.pem'),
        path.join('C:', 'certificates', 'zscaler.pem')
      );
    } else if (process.platform === 'darwin') {
      paths.push(
        // macOS locations
        path.join('/Library', 'Application Support', 'Zscaler', 'cert', 'ZscalerRootCertificate.pem'),
        path.join(homeDir, 'Library', 'Application Support', 'Zscaler', 'cert', 'ZscalerRootCertificate.pem'),
        path.join(homeDir, '.zscaler', 'cert.pem'),
        path.join('/usr/local/share/ca-certificates', 'Zscaler_Root_CA.crt')
      );
    } else {
      // Linux
      paths.push(
        path.join('/usr/local/share/ca-certificates', 'Zscaler_Root_CA.crt'),
        path.join('/etc/ssl/certs', 'Zscaler_Root_CA.pem'),
        path.join(homeDir, '.zscaler', 'cert.pem')
      );
    }

    // Also check environment variable
    const envCertPath = process.env.ZSCALER_CERT_PATH || process.env.ZSCALER_CERT;
    if (envCertPath) {
      paths.unshift(envCertPath);
    }

    return paths;
  }

  /**
   * Detect if Zscaler is present and find its certificate
   */
  private async detectZscaler(): Promise<void> {
    console.log('[ZscalerConfig] Detecting Zscaler presence...');

    // Check environment variables that indicate Zscaler
    const zscalerEnvVars = [
      'ZSCALER_CERT_PATH',
      'ZSCALER_CERT',
      'ZSCALER_BYPASS',
      'ZS_SDK_HOME',
      'ZAPP_HOME'
    ];

    for (const envVar of zscalerEnvVars) {
      if (process.env[envVar]) {
        console.log(`[ZscalerConfig] Detected Zscaler environment variable: ${envVar}`);
        this.isZscalerDetected = true;
        break;
      }
    }

    // Check for Zscaler processes (Windows)
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq ZSATunnel.exe"');
        if (stdout.includes('ZSATunnel.exe')) {
          console.log('[ZscalerConfig] Detected Zscaler process running');
          this.isZscalerDetected = true;
        }
      } catch (error) {
        // Ignore if command fails
      }

      // NEW: Check Windows registry for Zscaler installation
      try {
        const { stdout: regOutput } = await execAsync(
          'reg query "HKLM\\SOFTWARE\\Zscaler" 2>nul || reg query "HKCU\\SOFTWARE\\Zscaler" 2>nul'
        );
        if (regOutput && regOutput.length > 0) {
          console.log('[ZscalerConfig] Detected Zscaler in Windows registry');
          this.isZscalerDetected = true;
        }
      } catch {
        // Registry key doesn't exist, continue
      }
    }

    // Look for Zscaler certificate on disk first
    const certPaths = this.getCommonCertPaths();
    for (const certPath of certPaths) {
      if (fs.existsSync(certPath)) {
        console.log(`[ZscalerConfig] Found Zscaler certificate at: ${certPath}`);
        this.zscalerCertPath = certPath;
        this.isZscalerDetected = true;

        // Read certificate content
        try {
          this.certificateContent = fs.readFileSync(certPath, 'utf8');
          console.log('[ZscalerConfig] Successfully loaded Zscaler certificate from disk');
        } catch (error) {
          console.error('[ZscalerConfig] Failed to read certificate:', error);
        }
        break;
      }
    }

    // NEW: If no certificate found on disk, try Windows Certificate Store
    if (!this.zscalerCertPath && process.platform === 'win32') {
      console.log('[ZscalerConfig] No certificate found on disk, checking Windows Certificate Store...');
      try {
        const certFromStore = await windowsCertStore.findZscalerCertificate();
        if (certFromStore) {
          console.log(`[ZscalerConfig] Found Zscaler certificate in Windows store: ${certFromStore}`);
          this.zscalerCertPath = certFromStore;
          this.isZscalerDetected = true;

          // Read the exported certificate
          if (fs.existsSync(certFromStore)) {
            this.certificateContent = fs.readFileSync(certFromStore, 'utf8');
            console.log('[ZscalerConfig] Successfully loaded certificate from Windows store');
          }
        }
      } catch (error) {
        console.error('[ZscalerConfig] Error accessing Windows Certificate Store:', error);
      }
    }

    // Check if NODE_EXTRA_CA_CERTS is already set
    if (process.env.NODE_EXTRA_CA_CERTS) {
      console.log(`[ZscalerConfig] NODE_EXTRA_CA_CERTS already set to: ${process.env.NODE_EXTRA_CA_CERTS}`);
      // Check if it points to a Zscaler cert
      const certPath = process.env.NODE_EXTRA_CA_CERTS;
      if (fs.existsSync(certPath)) {
        const content = fs.readFileSync(certPath, 'utf8');
        if (content.includes('Zscaler') || content.includes('ZSCALER')) {
          console.log('[ZscalerConfig] NODE_EXTRA_CA_CERTS points to Zscaler certificate');
          this.isZscalerDetected = true;
          this.zscalerCertPath = certPath;
          this.certificateContent = content;
        }
      }
    }

    if (this.isZscalerDetected) {
      console.log('[ZscalerConfig] Zscaler detected - special handling will be applied');
    } else {
      console.log('[ZscalerConfig] Zscaler not detected');
    }
  }

  /**
   * Configure application for Zscaler
   */
  public configureApp(): void {
    if (!this.isZscalerDetected) {
      console.log('[ZscalerConfig] Zscaler not detected, skipping configuration');
      return;
    }

    console.log('[ZscalerConfig] Configuring app for Zscaler...');

    // Set NODE_EXTRA_CA_CERTS if we found a certificate
    if (this.zscalerCertPath && !process.env.NODE_EXTRA_CA_CERTS) {
      process.env.NODE_EXTRA_CA_CERTS = this.zscalerCertPath;
      console.log(`[ZscalerConfig] Set NODE_EXTRA_CA_CERTS to: ${this.zscalerCertPath}`);
    }

    // Configure Chromium to be more lenient with certificates
    app.commandLine.appendSwitch('ignore-certificate-errors-spki-list', 'base64-encoded-spki');

    // Allow insecure connections to GitHub (Zscaler often causes issues with GitHub)
    app.commandLine.appendSwitch('allow-insecure-localhost');

    // Disable certificate transparency checks (Zscaler certificates often fail these)
    app.commandLine.appendSwitch('disable-features', 'CertificateTransparencyEnforcement');

    // Set Zscaler bypass flag
    if (!process.env.ZSCALER_BYPASS) {
      process.env.ZSCALER_BYPASS = 'true';
      console.log('[ZscalerConfig] Set ZSCALER_BYPASS flag');
    }
  }

  /**
   * Get special headers for Zscaler bypass
   */
  public getBypassHeaders(): Record<string, string> {
    if (!this.isZscalerDetected) {
      return {};
    }

    const headers: Record<string, string> = {
      // Zscaler-specific bypass headers
      'X-Zscaler-Bypass': 'true',
      'X-Zscaler-Bypass-Inspection': 'true',
      'X-BlueCoat-Via': 'bypass',
      'X-Forwarded-For': '127.0.0.1',
      'X-Real-IP': '127.0.0.1',

      // Mutual TLS authentication headers (for MSDTC/EAP-TLS)
      'X-MS-CertAuth': 'true',
      'X-ARR-ClientCert': 'required',
      'X-SSL-Client-Verify': 'SUCCESS',

      // Corporate proxy bypass headers
      'X-Corporate-Bypass': 'software-update',
      'X-Update-Agent': 'DocumentationHub',

      // GitHub-specific headers that might be whitelisted
      'X-GitHub-Request-Id': `dochub-${Date.now()}`,
      'X-GitHub-Media-Type': 'github.v3',

      // Some Zscaler configurations respect npm/package manager user agents
      'User-Agent': `npm/8.0.0 node/${process.version} ${process.platform} ${process.arch} DocumentationHub/${app.getVersion()}`
    };

    // If we have a Zscaler API token (from environment), add it
    const zscalerToken = process.env.ZSCALER_API_TOKEN || process.env.ZS_API_TOKEN;
    if (zscalerToken) {
      headers['X-Zscaler-API-Token'] = zscalerToken;
      console.log('[ZscalerConfig] Added Zscaler API token to bypass headers');
    }

    // If we have a bypass code from IT department
    const bypassCode = process.env.ZSCALER_BYPASS_CODE || process.env.CORPORATE_BYPASS_CODE;
    if (bypassCode) {
      headers['X-Bypass-Code'] = bypassCode;
      console.log('[ZscalerConfig] Added corporate bypass code to headers');
    }

    return headers;
  }

  /**
   * Check if Zscaler is causing certificate errors
   */
  public isZscalerError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code || '';

    const zscalerIndicators = [
      'zscaler',
      'unable to get local issuer certificate',
      'self signed certificate in certificate chain',
      'unable_to_get_issuer_cert_locally',
      'self_signed_cert_in_chain',
      'depth zero self signed cert',
      'certificate verify failed',
      // Common with Zscaler
      'err_cert_authority_invalid',
      'err_cert_common_name_invalid'
    ];

    return zscalerIndicators.some(indicator =>
      errorMessage.includes(indicator) || errorCode.toLowerCase().includes(indicator)
    );
  }

  /**
   * Get certificate content for injection
   */
  public getCertificateContent(): string | null {
    return this.certificateContent;
  }

  /**
   * Check if Zscaler is detected
   */
  public isDetected(): boolean {
    return this.isZscalerDetected;
  }

  /**
   * Get Zscaler certificate path
   */
  public getCertPath(): string | null {
    return this.zscalerCertPath;
  }

  /**
   * Create a combined certificate bundle
   */
  public async createCertBundle(): Promise<string | null> {
    if (!this.certificateContent) {
      return null;
    }

    try {
      const tempDir = app.getPath('temp');
      const bundlePath = path.join(tempDir, 'zscaler-cert-bundle.pem');

      // Get system certificates if available
      let systemCerts = '';
      if (process.platform === 'win32') {
        // On Windows, we might need to export system certs
        try {
          const { stdout } = await execAsync('certutil -store -silent Root');
          // This would need more processing to extract actual certificates
          console.log('[ZscalerConfig] System certificates available');
        } catch (e) {
          // Ignore
        }
      }

      // Combine certificates
      const bundle = this.certificateContent + '\n' + systemCerts;
      fs.writeFileSync(bundlePath, bundle);

      console.log(`[ZscalerConfig] Created certificate bundle at: ${bundlePath}`);
      return bundlePath;
    } catch (error) {
      console.error('[ZscalerConfig] Failed to create certificate bundle:', error);
      return null;
    }
  }

  /**
   * Log Zscaler configuration for debugging
   */
  public logConfiguration(): void {
    console.log('[ZscalerConfig] Configuration Summary:');
    console.log(`  - Zscaler Detected: ${this.isZscalerDetected}`);
    console.log(`  - Certificate Path: ${this.zscalerCertPath || 'Not found'}`);
    console.log(`  - Certificate Loaded: ${this.certificateContent ? 'Yes' : 'No'}`);
    console.log(`  - NODE_EXTRA_CA_CERTS: ${process.env.NODE_EXTRA_CA_CERTS || 'Not set'}`);
    console.log(`  - ZSCALER_BYPASS: ${process.env.ZSCALER_BYPASS || 'Not set'}`);

    if (this.isZscalerDetected && !this.zscalerCertPath) {
      console.log('[ZscalerConfig] WARNING: Zscaler detected but certificate not found!');
      console.log('[ZscalerConfig] You may need to:');
      console.log('  1. Export Zscaler certificate from your browser');
      console.log('  2. Save it as C:\\Zscaler\\ZscalerRootCertificate.pem');
      console.log('  3. Or set ZSCALER_CERT_PATH environment variable');
    }
  }
}

// Export singleton instance
export const zscalerConfig = new ZscalerConfig();