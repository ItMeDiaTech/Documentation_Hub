import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { AlertCircle, CheckCircle2, Upload, Shield, Download, Info, Trash2 } from 'lucide-react';

interface Certificate {
  path: string;
  name: string;
  issuer?: string;
  subject?: string;
  validUntil?: string;
  isActive: boolean;
  isZscaler?: boolean;
}

export function CertificateManager() {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [isZscalerDetected, setIsZscalerDetected] = useState(false);
  const [certificateStatus, setCertificateStatus] = useState<'checking' | 'configured' | 'not-configured' | 'error'>('checking');
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error' | 'info' | null; message: string }>({ type: null, message: '' });
  const [currentCertPath, setCurrentCertPath] = useState<string>('');

  useEffect(() => {
    checkCertificateStatus();
    loadExistingCertificates();

    // Listen for certificate configuration from main process
    const handleCertificateConfigured = (data: any) => {
      setCertificateStatus('configured');
      setCurrentCertPath(data.certPath);
      loadExistingCertificates();
    };

    window.electronAPI.on('certificate-configured', handleCertificateConfigured);

    return () => {
      window.electronAPI.removeListener('certificate-configured', handleCertificateConfigured);
    };
  }, []);

  const checkCertificateStatus = async () => {
    try {
      // Check if Zscaler is detected
      const zscalerStatus = await window.electronAPI.checkZscalerStatus();
      setIsZscalerDetected(zscalerStatus.detected);

      // Check current certificate configuration
      const certPath = await window.electronAPI.getCertificatePath();
      if (certPath) {
        setCertificateStatus('configured');
        setCurrentCertPath(certPath);
      } else {
        setCertificateStatus('not-configured');
      }
    } catch (error) {
      console.error('Error checking certificate status:', error);
      setCertificateStatus('error');
    }
  };

  const loadExistingCertificates = async () => {
    try {
      const certs = await window.electronAPI.getInstalledCertificates();
      setCertificates(certs);
    } catch (error) {
      console.error('Error loading certificates:', error);
    }
  };

  const handleImportCertificate = async () => {
    try {
      const result = await window.electronAPI.importCertificate();

      if (result.success) {
        setImportStatus({
          type: 'success',
          message: `Certificate imported successfully: ${result.name}`
        });
        setCertificateStatus('configured');
        loadExistingCertificates();
      } else {
        setImportStatus({
          type: 'error',
          message: result.error || 'Failed to import certificate'
        });
      }
    } catch (error) {
      setImportStatus({
        type: 'error',
        message: 'Error importing certificate'
      });
    }

    // Clear status after 5 seconds
    setTimeout(() => {
      setImportStatus({ type: null, message: '' });
    }, 5000);
  };

  const handleExportFromBrowser = async () => {
    try {
      // Open instructions in browser
      await window.electronAPI.openExternal('https://github.com/ItMeDiaTech/Documentation_Hub/wiki/Export-Certificate-From-Browser');
    } catch (error) {
      console.error('Error opening browser guide:', error);
    }
  };

  const handleAutoDetect = async () => {
    setImportStatus({ type: 'info', message: 'Searching for certificates in Windows store...' });

    try {
      const result = await window.electronAPI.autoDetectCertificates();

      if (result.success) {
        setImportStatus({
          type: 'success',
          message: `Found and configured ${result.count} certificate(s)`
        });
        setCertificateStatus('configured');
        loadExistingCertificates();
      } else {
        setImportStatus({
          type: 'error',
          message: 'No Zscaler certificates found. You may need to export manually.'
        });
      }
    } catch (error) {
      setImportStatus({
        type: 'error',
        message: 'Error detecting certificates'
      });
    }

    setTimeout(() => {
      setImportStatus({ type: null, message: '' });
    }, 5000);
  };

  const handleRemoveCertificate = async (certPath: string) => {
    try {
      const result = await window.electronAPI.removeCertificate(certPath);
      if (result.success) {
        loadExistingCertificates();
      }
    } catch (error) {
      console.error('Error removing certificate:', error);
    }
  };

  const handleTestConnection = async () => {
    setImportStatus({ type: 'info', message: 'Testing connection to GitHub...' });

    try {
      const result = await window.electronAPI.testGitHubConnection();

      if (result.success) {
        setImportStatus({
          type: 'success',
          message: 'Connection successful! Updates should work now.'
        });
      } else {
        setImportStatus({
          type: 'error',
          message: `Connection failed: ${result.error}`
        });
      }
    } catch (error) {
      setImportStatus({
        type: 'error',
        message: 'Error testing connection'
      });
    }

    setTimeout(() => {
      setImportStatus({ type: null, message: '' });
    }, 5000);
  };

  return (
    <div className="space-y-4">
      {/* Status Banner */}
      {isZscalerDetected && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-yellow-600" />
              <CardTitle className="text-lg">Zscaler Detected</CardTitle>
            </div>
            <CardDescription>
              Zscaler is performing SSL inspection on your network. Certificate configuration is required for automatic updates.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Certificate Status */}
      <Card>
        <CardHeader>
          <CardTitle>Certificate Configuration</CardTitle>
          <CardDescription>
            Manage certificates for secure connections through corporate networks
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Status */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted">
            <div className="flex items-center gap-3">
              {certificateStatus === 'configured' ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-yellow-600" />
              )}
              <div>
                <p className="font-medium">
                  {certificateStatus === 'configured' ? 'Certificate Configured' : 'Certificate Not Configured'}
                </p>
                {currentCertPath && (
                  <p className="text-sm text-muted-foreground">{currentCertPath}</p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
            >
              Test Connection
            </Button>
          </div>

          {/* Import Status Message */}
          {importStatus.type && (
            <div className={`p-3 rounded-lg flex items-center gap-2 ${
              importStatus.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-950/20' :
              importStatus.type === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-950/20' :
              'bg-blue-50 text-blue-700 dark:bg-blue-950/20'
            }`}>
              <Info className="h-4 w-4" />
              <span className="text-sm">{importStatus.message}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              onClick={handleAutoDetect}
              variant="default"
              className="flex-1"
            >
              <Shield className="mr-2 h-4 w-4" />
              Auto-Detect Certificates
            </Button>
            <Button
              onClick={handleImportCertificate}
              variant="outline"
              className="flex-1"
            >
              <Upload className="mr-2 h-4 w-4" />
              Import Certificate
            </Button>
          </div>

          <Button
            onClick={handleExportFromBrowser}
            variant="ghost"
            className="w-full"
          >
            <Download className="mr-2 h-4 w-4" />
            How to Export Certificate from Browser
          </Button>
        </CardContent>
      </Card>

      {/* Installed Certificates */}
      {certificates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Installed Certificates</CardTitle>
            <CardDescription>
              Certificates currently available to the application
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {certificates.map((cert, index) => (
                <div key={index} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{cert.name}</p>
                      {cert.isZscaler && (
                        <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                          Zscaler
                        </span>
                      )}
                      {cert.isActive && (
                        <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                          Active
                        </span>
                      )}
                    </div>
                    {cert.issuer && (
                      <p className="text-sm text-muted-foreground">Issuer: {cert.issuer}</p>
                    )}
                    {cert.validUntil && (
                      <p className="text-sm text-muted-foreground">Valid until: {cert.validUntil}</p>
                    )}
                  </div>
                  <Button
                    onClick={() => handleRemoveCertificate(cert.path)}
                    variant="ghost"
                    size="icon"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Help Section */}
      <Card>
        <CardHeader>
          <CardTitle>Troubleshooting Guide</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-medium mb-1">If auto-detect doesn't work:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground ml-2">
                <li>Open Chrome or Edge and navigate to https://github.com</li>
                <li>Click the padlock icon in the address bar</li>
                <li>Select "Connection is secure" → "Certificate is valid"</li>
                <li>Go to the "Details" tab and select the root certificate</li>
                <li>Export as Base64 encoded .CER or .PEM file</li>
                <li>Use the "Import Certificate" button to import the file</li>
              </ol>
            </div>

            <div>
              <p className="font-medium mb-1">Common certificate names:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                <li>Zscaler Root CA</li>
                <li>Zscaler Intermediate Root CA</li>
                <li>Your Company Root CA</li>
                <li>Corporate Proxy Certificate</li>
              </ul>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-muted">
              <p className="text-xs text-muted-foreground">
                <strong>Note:</strong> If you continue to have issues, contact your IT department and request that
                *.github.com and *.githubusercontent.com be bypassed from SSL inspection.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}