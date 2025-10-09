import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, AlertCircle, FileArchive, Info, ExternalLink, AlertTriangle } from 'lucide-react';
import { Button } from './Button';

export function UpdateNotification() {
  const [isVisible, setIsVisible] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; fallbackUsed?: boolean } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isFallbackMode, setIsFallbackMode] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [downloadError, setDownloadError] = useState(false);
  const [errorCount, setErrorCount] = useState(0);

  useEffect(() => {
    // Listen for update available
    const unsubAvailable = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateInfo(info);
      setIsVisible(true);
    });

    // Listen for download progress
    const unsubProgress = window.electronAPI.onUpdateDownloadProgress((progress) => {
      setDownloadProgress(progress.percent);
    });

    // Listen for update downloaded
    const unsubDownloaded = window.electronAPI.onUpdateDownloaded((info) => {
      setIsDownloading(false);
      setIsExtracting(false);
      setIsDownloaded(true);
      setUpdateInfo({ ...info, fallbackUsed: info.fallbackUsed });
      if (info.fallbackUsed) {
        setStatusMessage('Update ready to install (downloaded as compressed archive)');
      }
    });

    // Listen for errors
    const unsubError = window.electronAPI.onUpdateError((error) => {
      setIsDownloading(false);
      setIsExtracting(false);
      setErrorCount(prev => prev + 1);

      // Check for certificate-specific errors
      const isCertError = error.message?.toLowerCase().includes('certificate') ||
                          error.message?.toLowerCase().includes('issuer') ||
                          error.message?.toLowerCase().includes('proxy') ||
                          error.message?.toLowerCase().includes('firewall');

      // Show error state after multiple failures or if fallback also failed
      if (error.message?.includes('Fallback download failed') || errorCount >= 2) {
        setDownloadError(true);

        if (isCertError) {
          setStatusMessage('Network security settings are blocking the download. Please download manually or contact IT.');
        } else {
          setStatusMessage('Unable to download automatically. Please try manual download.');
        }
      } else if (isCertError) {
        setStatusMessage('Certificate issue detected. Attempting alternative download method...');
      } else {
        setStatusMessage(`Connection issue: Trying alternative method...`);
      }
    });

    // Listen for fallback mode activation
    const unsubFallback = window.electronAPI.onUpdateFallbackMode?.((data) => {
      setIsFallbackMode(true);
      setStatusMessage(data.message || 'Using alternative download method...');
    });

    // Listen for extraction status
    const unsubExtracting = window.electronAPI.onUpdateExtracting?.((data) => {
      setIsExtracting(true);
      setStatusMessage(data.message || 'Extracting update...');
    });

    // Listen for general status updates
    const unsubStatus = window.electronAPI.onUpdateStatus?.((data) => {
      setStatusMessage(data.message || '');
    });

    return () => {
      unsubAvailable();
      unsubProgress();
      unsubDownloaded();
      unsubError();
      unsubFallback?.();
      unsubExtracting?.();
      unsubStatus?.();
    };
  }, [errorCount]); // Add errorCount to dependencies to track error state

  const handleDownload = async () => {
    setIsDownloading(true);
    setDownloadError(false); // Reset error state when retrying
    setErrorCount(0); // Reset error count
    try {
      await window.electronAPI.downloadUpdate();
    } catch (error) {
      setIsDownloading(false);
    }
  };

  const handleInstall = () => {
    window.electronAPI.installUpdate();
  };

  const handleDismiss = () => {
    setIsVisible(false);
  };

  const handleManualDownload = () => {
    // Open GitHub releases page in browser
    const releaseUrl = updateInfo?.version
      ? `https://github.com/ItMeDiaTech/Documentation_Hub/releases/tag/v${updateInfo.version}`
      : 'https://github.com/ItMeDiaTech/Documentation_Hub/releases/latest';

    // Open in external browser
    window.open(releaseUrl, '_blank');
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed bottom-4 right-4 z-50"
        >
          <div className="bg-background border border-border rounded-lg shadow-lg p-4 w-96">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                {isFallbackMode ? (
                  <FileArchive className="w-5 h-5 text-primary" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-primary" />
                )}
                <h3 className="font-semibold">Update Available</h3>
              </div>
              <button
                onClick={handleDismiss}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {updateInfo && (
              <p className="text-sm text-muted-foreground mb-4">
                Version {updateInfo.version} is now available
              </p>
            )}

            {statusMessage && (
              <div className="flex items-center gap-2 mb-3">
                <Info className="w-4 h-4 text-blue-500" />
                <p className="text-xs text-muted-foreground">{statusMessage}</p>
              </div>
            )}

            {!isDownloading && !isDownloaded && (
              <div className="flex gap-2">
                <Button
                  onClick={handleDownload}
                  variant="default"
                  size="sm"
                  className="flex-1"
                  icon={<Download className="w-4 h-4" />}
                >
                  Download
                </Button>
                <Button
                  onClick={handleDismiss}
                  variant="outline"
                  size="sm"
                >
                  Later
                </Button>
              </div>
            )}

            {isDownloading && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>
                    {isExtracting ? 'Extracting...' : isFallbackMode ? 'Downloading compressed update...' : 'Downloading...'}
                  </span>
                  {!isExtracting && (
                    <span className="text-muted-foreground">{Math.round(downloadProgress)}%</span>
                  )}
                </div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full ${isExtracting ? 'bg-blue-500' : 'bg-primary'} transition-all duration-300`}
                    style={{ width: isExtracting ? '100%' : `${downloadProgress}%` }}
                  />
                </div>
                {isFallbackMode && !isExtracting && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Using compressed download to bypass network restrictions
                  </p>
                )}
              </div>
            )}

            {isDownloaded && (
              <div className="flex gap-2">
                <Button
                  onClick={handleInstall}
                  variant="default"
                  size="sm"
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  Install & Restart
                </Button>
                <Button
                  onClick={handleDismiss}
                  variant="outline"
                  size="sm"
                >
                  Later
                </Button>
              </div>
            )}

            {downloadError && !isDownloading && !isDownloaded && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                  <AlertTriangle className="w-4 h-4" />
                  <p className="text-xs font-medium">Network Security Issue</p>
                </div>
                {statusMessage && (
                  <p className="text-xs text-muted-foreground">{statusMessage}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={handleManualDownload}
                    variant="default"
                    size="sm"
                    className="flex-1"
                    icon={<ExternalLink className="w-4 h-4" />}
                  >
                    Download Manually
                  </Button>
                  <Button
                    onClick={handleDownload}
                    variant="outline"
                    size="sm"
                    icon={<Download className="w-4 h-4" />}
                  >
                    Retry
                  </Button>
                </div>
                <div className="bg-muted/50 rounded p-2 text-xs space-y-1">
                  <p className="font-medium">Troubleshooting Tips:</p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                    <li>Disconnect from VPN if connected</li>
                    <li>Check with IT about proxy settings</li>
                    <li>Use manual download for immediate access</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
