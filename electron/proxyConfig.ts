import { app } from 'electron';
import * as os from 'os';

/**
 * Proxy configuration and detection for corporate environments
 */
export class ProxyConfig {
  private proxyUrl: string | null = null;
  private proxyAuth: { username: string; password: string } | null = null;
  private bypassList: string[] = ['localhost', '127.0.0.1', '<local>'];

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

    // Configure proxy authentication handler
    if (this.proxyAuth) {
      app.on('login', (event, webContents, request, authInfo, callback) => {
        if (authInfo.isProxy && this.proxyAuth) {
          event.preventDefault();
          console.log('[ProxyConfig] Providing proxy authentication');
          callback(this.proxyAuth.username, this.proxyAuth.password);
        }
      });
    }
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
   * Log proxy configuration for debugging
   */
  public logConfiguration(): void {
    console.log('[ProxyConfig] Configuration Summary:');
    console.log(`  - Proxy URL: ${this.proxyUrl || 'Not configured (direct connection)'}`);
    console.log(`  - Proxy Auth: ${this.proxyAuth ? 'Configured' : 'Not configured'}`);
    console.log(`  - Bypass List: ${this.bypassList.join(', ')}`);
    console.log(`  - NODE_EXTRA_CA_CERTS: ${process.env.NODE_EXTRA_CA_CERTS || 'Not configured'}`);
    console.log(`  - NODE_TLS_REJECT_UNAUTHORIZED: ${process.env.NODE_TLS_REJECT_UNAUTHORIZED || 'Default (1)'}`);
    console.log(`  - Platform: ${os.platform()}`);
    console.log(`  - Node Version: ${process.version}`);
    console.log(`  - Electron Version: ${process.versions.electron}`);
  }
}

// Export singleton instance
export const proxyConfig = new ProxyConfig();