import { app, session } from 'electron';
import * as os from 'os';
import { zscalerConfig } from './zscalerConfig';

/**
 * Proxy configuration and detection for corporate environments
 * Enhanced with session management, connection cleanup, and Zscaler integration
 */
export class ProxyConfig {
  private proxyUrl: string | null = null;
  private proxyAuth: { username: string; password: string } | null = null;
  private bypassList: string[] = ['localhost', '127.0.0.1', '<local>'];
  private isProxyConfigured: boolean = false;
  private maxRetries: number = 3;

  constructor() {
    this.detectProxy();
  }

  /**
   * Detect proxy settings from environment variables
   */
  private detectProxy(): void {
    // Check common proxy environment variables
    const proxyEnvVars = [
      'HTTPS_PROXY',
      'https_proxy',
      'HTTP_PROXY',
      'http_proxy',
      'ALL_PROXY',
      'all_proxy'
    ];

    for (const envVar of proxyEnvVars) {
      const proxyValue = process.env[envVar];
      if (proxyValue) {
        this.proxyUrl = proxyValue;
        console.log(`[ProxyConfig] Detected proxy from ${envVar}: ${this.proxyUrl}`);
        break;
      }
    }

    // If Zscaler is detected but no proxy is set, use a default Zscaler proxy
    if (!this.proxyUrl && zscalerConfig.isDetected()) {
      console.log('[ProxyConfig] Zscaler detected but no proxy configured');
      // Zscaler typically uses transparent proxy, so we might not need explicit proxy settings
      // But we should ensure certificate handling is properly configured
      console.log('[ProxyConfig] Relying on Zscaler transparent proxy');
    }

    // Check for NO_PROXY bypass list
    const noProxy = process.env.NO_PROXY || process.env.no_proxy;
    if (noProxy) {
      this.bypassList = [...this.bypassList, ...noProxy.split(',').map(s => s.trim())];
      console.log(`[ProxyConfig] Proxy bypass list: ${this.bypassList.join(', ')}`);
    }

    // Check for proxy authentication
    const proxyUsername = process.env.PROXY_USERNAME || process.env.proxy_username;
    const proxyPassword = process.env.PROXY_PASSWORD || process.env.proxy_password;

    if (proxyUsername && proxyPassword) {
      this.proxyAuth = { username: proxyUsername, password: proxyPassword };
      console.log('[ProxyConfig] Proxy authentication configured');
    }

    // Log corporate CA certificate configuration
    const caCert = process.env.NODE_EXTRA_CA_CERTS;
    if (caCert) {
      console.log(`[ProxyConfig] Corporate CA certificate configured: ${caCert}`);
    }
  }

  /**
   * Configure Electron app with proxy settings
   */
  public configureApp(): void {
    if (!this.proxyUrl) {
      console.log('[ProxyConfig] No proxy detected, using direct connection');
      return;
    }

    // Set proxy for Electron
    console.log(`[ProxyConfig] Configuring app with proxy: ${this.proxyUrl}`);

    // Configure command line switches for Chromium
    app.commandLine.appendSwitch('proxy-server', this.proxyUrl);

    if (this.bypassList.length > 0) {
      app.commandLine.appendSwitch('proxy-bypass-list', this.bypassList.join(','));
    }

    // Configure proxy authentication handler at app level
    if (this.proxyAuth) {
      app.on('login', (event, webContents, request, authInfo, callback) => {
        if (authInfo.isProxy && this.proxyAuth) {
          event.preventDefault();
          console.log('[ProxyConfig] Providing proxy authentication for:', authInfo.host);
          callback(this.proxyAuth.username, this.proxyAuth.password);
        }
      });
    }
  }

  /**
   * Configure session-level proxy with connection cleanup
   * This is crucial for preventing ECONNRESET errors
   */
  public async configureSessionProxy(ses?: Electron.Session): Promise<void> {
    const targetSession = ses || session.defaultSession;

    try {
      // CRITICAL: Close all existing connections to prevent connection pool reuse
      console.log('[ProxyConfig] Closing all existing connections...');
      console.log('[ProxyConfig] Session info:', {
        cacheSize: await targetSession.getCacheSize(),
        userAgent: targetSession.getUserAgent().substring(0, 100),
        protocol: targetSession.protocol
      });
      await targetSession.closeAllConnections();

      if (!this.proxyUrl) {
        console.log('[ProxyConfig] No proxy detected, configuring direct connection');
        await targetSession.setProxy({ mode: 'direct' });
        this.isProxyConfigured = true;
        return;
      }

      console.log('[ProxyConfig] Configuring session proxy:', this.proxyUrl);

      // Build proxy configuration
      const proxyConfig: Electron.ProxyConfig = {
        proxyRules: this.proxyUrl,
        proxyBypassRules: this.bypassList.join(',')
      };

      // Check for PAC script
      const pacUrl = process.env.PAC_URL || process.env.pac_url;
      if (pacUrl) {
        console.log('[ProxyConfig] Using PAC script:', pacUrl);
        proxyConfig.pacScript = pacUrl;
        proxyConfig.mode = 'pac_script';
      }

      // Apply proxy configuration
      await targetSession.setProxy(proxyConfig);

      // Force reload proxy configuration
      await targetSession.forceReloadProxyConfig();

      console.log('[ProxyConfig] Session proxy configured successfully');
      this.isProxyConfigured = true;

    } catch (error) {
      console.error('[ProxyConfig] Failed to configure session proxy:', error);
      throw error;
    }
  }

  /**
   * Reset proxy configuration with retry logic
   */
  public async resetProxyWithRetry(ses?: Electron.Session, retryCount: number = 0): Promise<void> {
    const targetSession = ses || session.defaultSession;

    try {
      console.log(`[ProxyConfig] Resetting proxy configuration (attempt ${retryCount + 1}/${this.maxRetries})`);

      // Close all connections
      await targetSession.closeAllConnections();

      // Wait a bit for connections to fully close
      await new Promise(resolve => setTimeout(resolve, 500));

      // Reconfigure proxy
      await this.configureSessionProxy(targetSession);

    } catch (error) {
      if (retryCount < this.maxRetries - 1) {
        console.log('[ProxyConfig] Retrying proxy reset...');
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return this.resetProxyWithRetry(targetSession, retryCount + 1);
      }
      throw error;
    }
  }

  /**
   * Get User-Agent without Electron identifier
   * Some corporate proxies reject requests with "Electron" in User-Agent
   */
  public getCleanUserAgent(): string {
    const currentUA = session.defaultSession.getUserAgent();
    // Remove Electron/ and Electron-specific identifiers
    const cleanUA = currentUA
      .split(' ')
      .filter(part => !part.includes('Electron'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    console.log('[ProxyConfig] Clean User-Agent:', cleanUA);
    return cleanUA;
  }

  /**
   * Get proxy configuration for net.request
   */
  public getProxyConfig(): { proxyRules?: string; pacScript?: string } | null {
    if (!this.proxyUrl) {
      return null;
    }

    return {
      proxyRules: this.proxyUrl,
      // pacScript can be added if PAC file URL is provided via environment variable
    };
  }

  /**
   * Check if URL should bypass proxy
   */
  public shouldBypassProxy(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Check if hostname is in bypass list
      for (const bypass of this.bypassList) {
        if (bypass === '<local>' && !hostname.includes('.')) {
          return true;
        }
        if (hostname === bypass || hostname.endsWith(`.${bypass}`)) {
          return true;
        }
      }
    } catch (error) {
      console.error('[ProxyConfig] Error checking bypass:', error);
    }

    return false;
  }

  /**
   * Get proxy URL
   */
  public getProxyUrl(): string | null {
    return this.proxyUrl;
  }

  /**
   * Get proxy authentication credentials
   */
  public getProxyAuth(): { username: string; password: string } | null {
    return this.proxyAuth;
  }

  /**
   * Check if proxy is configured
   */
  public isConfigured(): boolean {
    return this.isProxyConfigured;
  }

  /**
   * Log proxy configuration for debugging
   */
  public logConfiguration(): void {
    console.log('[ProxyConfig] Configuration Summary:');
    console.log(`  - Proxy URL: ${this.proxyUrl || 'Not configured (direct connection)'}`);
    console.log(`  - Proxy Auth: ${this.proxyAuth ? 'Configured' : 'Not configured'}`);
    console.log(`  - Bypass List: ${this.bypassList.join(', ')}`);
    console.log(`  - Zscaler Status: ${zscalerConfig.isDetected() ? 'DETECTED' : 'Not detected'}`);
    console.log(`  - NODE_EXTRA_CA_CERTS: ${process.env.NODE_EXTRA_CA_CERTS || 'Not configured'}`);
    console.log(`  - NODE_TLS_REJECT_UNAUTHORIZED: ${process.env.NODE_TLS_REJECT_UNAUTHORIZED || 'Default (1)'}`);
    console.log(`  - ZSCALER_BYPASS: ${process.env.ZSCALER_BYPASS || 'Not set'}`);
    console.log(`  - Platform: ${os.platform()}`);
    console.log(`  - Node Version: ${process.version}`);
    console.log(`  - Electron Version: ${process.versions.electron}`);
    console.log(`  - App Version: ${app.getVersion()}`);
    console.log(`  - System Locale: ${app.getLocale()}`);
  }
}

// Export singleton instance
export const proxyConfig = new ProxyConfig();