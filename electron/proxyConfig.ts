import { app, session } from 'electron';
import * as os from 'os';
import { zscalerConfig } from './zscalerConfig';
import { logger } from '../src/utils/logger';

const log = logger.namespace('ProxyConfig');

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
    this.detectLocalProxy();
  }

  /**
   * Detect localhost proxy servers (WSUS, MSDTC, etc.)
   */
  private detectLocalProxy(): void {
    // Common local proxy ports used by enterprise software
    const localProxyPorts = [
      8005,  // WSUS/MSDTC (as reported by user)
      8080,  // Common proxy port
      3128,  // Squid default
      8888,  // Fiddler/Charles
      9090,  // Another common proxy
      1080   // SOCKS proxy
    ];

    // Check if we already have a proxy configured
    if (this.proxyUrl && !this.proxyUrl.includes('localhost') && !this.proxyUrl.includes('127.0.0.1')) {
      log.info('[ZscalerConfig] Non-localhost proxy already configured, skipping localhost detection');
      return;
    }

    // Check for specific localhost proxies
    for (const port of localProxyPorts) {
      // Check if this might be the active proxy
      if (process.env[`LOCALHOST_PROXY_${port}`] === 'true') {
        const proxyUrl = `http://localhost:${port}`;
        log.info(` Detected localhost proxy on port ${port} from environment`);

        if (port === 8005) {
          log.info('[ZscalerConfig] ⚠️  WSUS/MSDTC proxy detected on port 8005 - Mutual TLS likely required');
          log.info('[ZscalerConfig] This proxy requires special handling for certificate authentication');
        }

        // Only set if we don't already have a proxy
        if (!this.proxyUrl) {
          this.proxyUrl = proxyUrl;
          log.info(` Using localhost proxy: ${proxyUrl}`);
        }
        break;
      }
    }

    // Log if we detect the Windows Update localhost:8005 configuration
    if (!this.proxyUrl) {
      log.info('[ZscalerConfig] Checking for Windows Update proxy configuration...');
      // This is informational - the actual proxy might be transparent
      log.info('[ZscalerConfig] Note: Windows Update may be using localhost:8005 for WSUS');
      log.info('[ZscalerConfig] This often indicates enterprise network with mutual TLS requirements');
    }
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
        log.info(` Detected proxy from ${envVar}: ${this.proxyUrl}`);
        break;
      }
    }

    // If Zscaler is detected but no proxy is set, use a default Zscaler proxy
    if (!this.proxyUrl && zscalerConfig.isDetected()) {
      log.info('[ZscalerConfig] Zscaler detected but no proxy configured');
      // Zscaler typically uses transparent proxy, so we might not need explicit proxy settings
      // But we should ensure certificate handling is properly configured
      log.info('[ZscalerConfig] Relying on Zscaler transparent proxy');
    }

    // Check for NO_PROXY bypass list
    const noProxy = process.env.NO_PROXY || process.env.no_proxy;
    if (noProxy) {
      this.bypassList = [...this.bypassList, ...noProxy.split(',').map(s => s.trim())];
      log.info(` Proxy bypass list: ${this.bypassList.join(', ')}`);
    }

    // Check for proxy authentication
    const proxyUsername = process.env.PROXY_USERNAME || process.env.proxy_username;
    const proxyPassword = process.env.PROXY_PASSWORD || process.env.proxy_password;

    if (proxyUsername && proxyPassword) {
      this.proxyAuth = { username: proxyUsername, password: proxyPassword };
      log.info('[ZscalerConfig] Proxy authentication configured (credentials masked)');
    }

    // Log corporate CA certificate configuration
    const caCert = process.env.NODE_EXTRA_CA_CERTS;
    if (caCert) {
      log.info(` Corporate CA certificate configured: ${caCert}`);
    }
  }

  /**
   * Configure Electron app with proxy settings
   */
  public configureApp(): void {
    if (!this.proxyUrl) {
      log.info('[ZscalerConfig] No proxy detected, using direct connection');
      return;
    }

    // Set proxy for Electron
    log.info(`[ProxyConfig] Configuring app with proxy: ${this.proxyUrl}`);

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
          log.info('[ZscalerConfig] Providing proxy authentication for:', authInfo.host);
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
      log.info('[ZscalerConfig] Closing all existing connections...');
      log.info('[ZscalerConfig] Session info:', {
        cacheSize: await targetSession.getCacheSize(),
        userAgent: targetSession.getUserAgent().substring(0, 100),
        protocol: targetSession.protocol
      });
      await targetSession.closeAllConnections();

      if (!this.proxyUrl) {
        log.info('[ZscalerConfig] No proxy detected, configuring direct connection');
        await targetSession.setProxy({ mode: 'direct' });
        this.isProxyConfigured = true;
        return;
      }

      log.info('[ZscalerConfig] Configuring session proxy:', this.proxyUrl);

      // Build proxy configuration
      const proxyConfig: Electron.ProxyConfig = {
        proxyRules: this.proxyUrl,
        proxyBypassRules: this.bypassList.join(',')
      };

      // Check for PAC script
      const pacUrl = process.env.PAC_URL || process.env.pac_url;
      if (pacUrl) {
        log.info('[ZscalerConfig] Using PAC script:', pacUrl);
        proxyConfig.pacScript = pacUrl;
        proxyConfig.mode = 'pac_script';
      }

      // Apply proxy configuration
      await targetSession.setProxy(proxyConfig);

      // Force reload proxy configuration
      await targetSession.forceReloadProxyConfig();

      log.info('[ZscalerConfig] Session proxy configured successfully');
      this.isProxyConfigured = true;

    } catch (error) {
      log.error('[ZscalerConfig] Failed to configure session proxy:', error);
      throw error;
    }
  }

  /**
   * Reset proxy configuration with retry logic
   */
  public async resetProxyWithRetry(ses?: Electron.Session, retryCount: number = 0): Promise<void> {
    const targetSession = ses || session.defaultSession;

    try {
      log.info(` Resetting proxy configuration (attempt ${retryCount + 1}/${this.maxRetries})`);

      // Close all connections
      await targetSession.closeAllConnections();

      // Wait a bit for connections to fully close
      await new Promise(resolve => setTimeout(resolve, 500));

      // Reconfigure proxy
      await this.configureSessionProxy(targetSession);

    } catch (error) {
      if (retryCount < this.maxRetries - 1) {
        log.info('[ZscalerConfig] Retrying proxy reset...');
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

    log.info('[ZscalerConfig] Clean User-Agent:', cleanUA);
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
      log.error('[ZscalerConfig] Error checking bypass:', error);
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
    log.info('[ZscalerConfig] Configuration Summary:');
    log.info(`  - Proxy URL: ${this.proxyUrl || 'Not configured (direct connection)'}`);
    log.info(`  - Proxy Auth: ${this.proxyAuth ? 'Configured' : 'Not configured'}`);
    log.info(`  - Bypass List: ${this.bypassList.join(', ')}`);
    log.info(`  - Zscaler Status: ${zscalerConfig.isDetected() ? 'DETECTED' : 'Not detected'}`);
    log.info(`  - NODE_EXTRA_CA_CERTS: ${process.env.NODE_EXTRA_CA_CERTS || 'Not configured'}`);
    log.info(`  - NODE_TLS_REJECT_UNAUTHORIZED: ${process.env.NODE_TLS_REJECT_UNAUTHORIZED || 'Default (1)'}`);
    log.info(`  - ZSCALER_BYPASS: ${process.env.ZSCALER_BYPASS || 'Not set'}`);
    log.info(`  - Platform: ${os.platform()}`);
    log.info(`  - Node Version: ${process.version}`);
    log.info(`  - Electron Version: ${process.versions.electron}`);
    log.info(`  - App Version: ${app.getVersion()}`);
    log.info(`  - System Locale: ${app.getLocale()}`);
  }
}

// Export singleton instance
export const proxyConfig = new ProxyConfig();