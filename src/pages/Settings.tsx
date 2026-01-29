import { Button } from '@/components/common/Button';
import { ColorPickerDialog } from '@/components/common/ColorPickerDialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Input } from '@/components/common/Input';
import { SegmentedControl } from '@/components/settings/SegmentedControl';
import { SettingRow } from '@/components/settings/SettingRow';
import * as Switch from '@radix-ui/react-switch';
import { useGlobalStats } from '@/contexts/GlobalStatsContext';
import { useSession } from '@/contexts/SessionContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useUserSettings } from '@/contexts/UserSettingsContext';
import { cn } from '@/utils/cn';
import { getContrastTextColor } from '@/utils/colorConvert';
import logger from '@/utils/logger';
import { hasEncodingIssues, sanitizeUrl, validatePowerAutomateUrl } from '@/utils/urlHelpers';
import { motion } from 'framer-motion';
import {
  Accessibility,
  AlertCircle,
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Download,
  Globe,
  HardDrive,
  Laptop,
  Lightbulb,
  Link2,
  LogOut,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Sun,
  Type,
  User,
  Wifi,
  Zap
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const settingsSections = [
  {
    group: 'Account',
    items: [
      { id: 'profile', label: 'Profile', icon: User, description: 'Personal information' },
    ],
  },
  {
    group: 'Customization',
    items: [
      { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme & colors' },
      { id: 'typography', label: 'Typography', icon: Type, description: 'Fonts & text styling' },
      { id: 'display', label: 'Display', icon: Monitor, description: 'Monitor settings' },
    ],
  },
  {
    group: 'System',
    items: [
      { id: 'language', label: 'Language', icon: Globe, description: 'Region & locale' },
      { id: 'updates', label: 'Updates', icon: Download, description: 'App updates & versioning' },
      {
        id: 'api-connections',
        label: 'API Connections',
        icon: Link2,
        description: 'External services',
      },
      {
        id: 'local-dictionary',
        label: 'Local Dictionary',
        icon: HardDrive,
        description: 'Offline hyperlink lookups',
      },
      {
        id: 'backup-settings',
        label: 'Backups',
        icon: Archive,
        description: 'Document backup options',
      },
      {
        id: 'submit-idea',
        label: 'Submit Idea for New Implementation',
        icon: Lightbulb,
        description: 'Share your ideas',
      },
    ],
  },
];

export function Settings() {
  const [activeSection, setActiveSection] = useState('profile');
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaBenefit, setIdeaBenefit] = useState('');
  const [ideaSubmitted, setIdeaSubmitted] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');
  const [currentVersion, setCurrentVersion] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);

  // SharePoint update source states
  const [sharePointLoginStatus, setSharePointLoginStatus] = useState<'logged-out' | 'logging-in' | 'logged-in'>('logged-out');
  const [testingSharePointConnection, setTestingSharePointConnection] = useState(false);
  const [sharePointConnectionResult, setSharePointConnectionResult] = useState<{ success: boolean; message: string } | null>(null);

  const {
    settings,
    updateProfile,
    updateNotifications,
    updateApiConnections,
    updateUpdateSettings,
    updateLocalDictionary,
    updateBackupSettings,
    updateDisplaySettings,
    updateSettings,
    saveSettings,
  } = useUserSettings();
  const { sessions } = useSession();
  const { stats, resetAllStats } = useGlobalStats();

  // Local form states
  const [profileForm, setProfileForm] = useState(settings.profile);
  const [notificationsForm, setNotificationsForm] = useState(settings.notifications);
  const [apiConnectionsForm, setApiConnectionsForm] = useState(settings.apiConnections);
  const [languageForm, setLanguageForm] = useState(settings.language);
  const [timezoneForm, setTimezoneForm] = useState(settings.timezone);
  const [dateFormatForm, setDateFormatForm] = useState(settings.dateFormat);
  const [updateSettingsForm, setUpdateSettingsForm] = useState(settings.updateSettings);
  const [localDictionaryForm, setLocalDictionaryForm] = useState(settings.localDictionary);
  const [backupSettingsForm, setBackupSettingsForm] = useState(settings.backupSettings);
  const [displaySettingsForm, setDisplaySettingsForm] = useState(settings.displaySettings);

  // Display settings states
  const [availableDisplays, setAvailableDisplays] = useState<Array<{
    id: number;
    label: string;
    bounds: { x: number; y: number; width: number; height: number };
    workArea: { x: number; y: number; width: number; height: number };
    isPrimary: boolean;
  }>>([]);
  const [identifyingMonitors, setIdentifyingMonitors] = useState(false);

  // Dictionary sync states
  const [dictionaryStatus, setDictionaryStatus] = useState<{
    enabled: boolean;
    lastSyncTime: string | null;
    lastSyncSuccess: boolean;
    totalEntries: number;
    syncInProgress: boolean;
    syncProgress: number;
    syncError: string | null;
    nextScheduledSync: string | null;
  } | null>(null);
  const [syncingDictionary, setSyncingDictionary] = useState(false);
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [showClientSecretDialog, setShowClientSecretDialog] = useState(false);
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const [showResetStatsDialog, setShowResetStatsDialog] = useState(false);
  const [isResettingStats, setIsResettingStats] = useState(false);

  // Timeout refs for cleanup
  const urlWarningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const saveSuccessTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const ideaSubmittedTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get current version on mount
  useEffect(() => {
    const getVersion = async () => {
      try {
        if (!window.electronAPI?.getCurrentVersion) {
          console.warn('Settings: electronAPI.getCurrentVersion not available');
          return;
        }
        const version = await window.electronAPI.getCurrentVersion();
        setCurrentVersion(version);
    } catch (_error) {
      // Silently handle version retrieval errors
    }
    };
    getVersion();
  }, []);

  // Update event listeners
  useEffect(() => {
    // Safely check if electronAPI is available
    if (typeof window.electronAPI === 'undefined') {
      console.warn('Settings: electronAPI not available (running in browser mode?)');
      return;
    }

    const unsubAvailable = window.electronAPI.onUpdateAvailable(
      (info: { version: string; releaseDate: string; releaseNotes: string }) => {
        setUpdateAvailable(true);
        setUpdateVersion(info.version);
        setUpdateStatus(`Update available: ${info.version}`);
        setCheckingForUpdates(false);
      }
    );

    const unsubProgress = window.electronAPI.onUpdateDownloadProgress(
      (progress: {
        bytesPerSecond: number;
        percent: number;
        transferred: number;
        total: number;
      }) => {
        setDownloadProgress(progress.percent);
        setUpdateStatus(`Downloading update: ${Math.round(progress.percent)}%`);
      }
    );

    const unsubDownloaded = window.electronAPI.onUpdateDownloaded(
      (info: { version: string; releaseNotes: string; fallbackUsed?: boolean }) => {
        setUpdateDownloaded(true);
        setDownloadProgress(100);
        setUpdateStatus(`Update ${info.version} downloaded. Ready to install.`);
      }
    );

    const unsubNotAvailable = window.electronAPI.onUpdateNotAvailable(
      (_info: { version: string }) => {
        setUpdateAvailable(false);
        setUpdateStatus('You are up to date');
        setCheckingForUpdates(false);
      }
    );

    const unsubError = window.electronAPI.onUpdateError((error: { message: string }) => {
      setUpdateStatus(`Update error: ${error.message}`);
      setCheckingForUpdates(false);
    });

    return () => {
      unsubAvailable();
      unsubProgress();
      unsubDownloaded();
      unsubNotAvailable();
      unsubError();
    };
  }, []);

  // Update local states when settings change
  useEffect(() => {
    setProfileForm(settings.profile);
    setNotificationsForm(settings.notifications);
    setApiConnectionsForm(settings.apiConnections);
    setLanguageForm(settings.language);
    setTimezoneForm(settings.timezone);
    setDateFormatForm(settings.dateFormat);
    setUpdateSettingsForm(settings.updateSettings);
    setLocalDictionaryForm(settings.localDictionary);
    setBackupSettingsForm(settings.backupSettings);
    setDisplaySettingsForm(settings.displaySettings);
  }, [settings]);

  // Fetch available displays when display section is active
  useEffect(() => {
    const fetchDisplays = async () => {
      if (typeof window.electronAPI === 'undefined' || !window.electronAPI.display) return;
      try {
        const displays = await window.electronAPI.display.getAllDisplays();
        setAvailableDisplays(displays);
      } catch (_error) {
        // Silent fail - displays not available
      }
    };

    if (activeSection === 'display') {
      fetchDisplays();
    }
  }, [activeSection]);

  // Dictionary status polling
  useEffect(() => {
    const fetchDictionaryStatus = async () => {
      if (typeof window.electronAPI === 'undefined') return;
      try {
        const result = await window.electronAPI.dictionary.getStatus();
        if (result.success && result.status) {
          setDictionaryStatus(result.status);
        }
      } catch (_error) {
        // Silent fail - dictionary not initialized yet
      }
    };

    // Fetch on mount and when dictionary section is active
    if (activeSection === 'local-dictionary') {
      fetchDictionaryStatus();
      const interval = setInterval(fetchDictionaryStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [activeSection]);

  // Dictionary sync progress listener
  useEffect(() => {
    if (typeof window.electronAPI === 'undefined') return;

    const unsubProgress = window.electronAPI.dictionary.onSyncProgress((progress) => {
      setDictionaryStatus((prev) =>
        prev ? { ...prev, syncProgress: progress.progress, syncInProgress: true } : null
      );
    });

    const unsubComplete = window.electronAPI.dictionary.onSyncComplete((result) => {
      setSyncingDictionary(false);
      if (result.success) {
        // Refresh status after sync
        window.electronAPI.dictionary.getStatus().then((res) => {
          if (res.success && res.status) {
            setDictionaryStatus(res.status);
          }
        });
      }
    });

    return () => {
      unsubProgress();
      unsubComplete();
    };
  }, []);

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      if (urlWarningTimeoutRef.current) {
        clearTimeout(urlWarningTimeoutRef.current);
      }
      if (saveSuccessTimeoutRef.current) {
        clearTimeout(saveSuccessTimeoutRef.current);
      }
      if (ideaSubmittedTimeoutRef.current) {
        clearTimeout(ideaSubmittedTimeoutRef.current);
      }
    };
  }, []);

  const handlePowerAutomateUrlChange = (url: string) => {
    // Update form
    setApiConnectionsForm({ ...apiConnectionsForm, powerAutomateUrl: url });

    // Auto-sanitize if encoding issues detected
    if (hasEncodingIssues(url)) {
      const sanitized = sanitizeUrl(url);
      setShowUrlWarning(true);
      if (urlWarningTimeoutRef.current) {
        clearTimeout(urlWarningTimeoutRef.current);
      }
      urlWarningTimeoutRef.current = setTimeout(() => {
        setApiConnectionsForm({ ...apiConnectionsForm, powerAutomateUrl: sanitized });
        setShowUrlWarning(false);
        urlWarningTimeoutRef.current = null;
      }, 1500);
    }

    // Validate URL
    if (url.trim()) {
      const validation = validatePowerAutomateUrl(url);
      setUrlValidation(validation);
    } else {
      setUrlValidation(null);
    }
  };

  const handleResetStats = async () => {
    setIsResettingStats(true);
    try {
      await resetAllStats();
      setShowResetStatsDialog(false);
    } catch (error) {
      logger.error('Failed to reset stats:', error);
    } finally {
      setIsResettingStats(false);
    }
  };

  const handleSaveSettings = async () => {
    // Sanitize PowerAutomate URL before saving
    if (apiConnectionsForm.powerAutomateUrl) {
      const sanitized = sanitizeUrl(apiConnectionsForm.powerAutomateUrl);
      apiConnectionsForm.powerAutomateUrl = sanitized;
    }

    // Update all settings
    updateProfile(profileForm);
    updateNotifications(notificationsForm);
    updateApiConnections(apiConnectionsForm);
    updateUpdateSettings(updateSettingsForm);
    updateSettings({
      language: languageForm,
      timezone: timezoneForm,
      dateFormat: dateFormatForm,
    });

    // Configure update provider based on SharePoint settings
    if (typeof window.electronAPI !== 'undefined') {
      if (updateSettingsForm.useSharePointSource && updateSettingsForm.sharePointFolderUrl) {
        await window.electronAPI.setUpdateProvider({
          type: 'sharepoint',
          sharePointUrl: updateSettingsForm.sharePointFolderUrl,
        });
      } else {
        await window.electronAPI.setUpdateProvider({ type: 'github' });
      }
    }

    // Save to localStorage
    const success = await saveSettings();
    if (success) {
      setSaveSuccess(true);
      if (saveSuccessTimeoutRef.current) {
        clearTimeout(saveSuccessTimeoutRef.current);
      }
      saveSuccessTimeoutRef.current = setTimeout(() => {
        setSaveSuccess(false);
        saveSuccessTimeoutRef.current = null;
      }, 2000);
    }
  };

  const handleCheckForUpdates = async () => {
    setCheckingForUpdates(true);
    setUpdateStatus('Checking for updates...');
    setUpdateAvailable(false);
    setUpdateDownloaded(false);
    setDownloadProgress(0);

    try {
      await window.electronAPI?.checkForUpdates();
      // Status will be updated by event listeners
    } catch (_error) {
      setUpdateStatus('Error checking for updates');
      setCheckingForUpdates(false);
    }
  };

  const handleDownloadUpdate = async () => {
    setUpdateStatus('Starting download...');
    try {
      await window.electronAPI?.downloadUpdate();
      // Progress will be updated by event listeners
    } catch (_error) {
      setUpdateStatus('Download failed');
    }
  };

  const handleInstallUpdate = () => {
    // This will quit the app and install the update
    window.electronAPI?.installUpdate();
  };

  // SharePoint update source handlers
  const handleSharePointLogin = async () => {
    setSharePointLoginStatus('logging-in');
    try {
      const result = await window.electronAPI?.sharePointLogin();
      setSharePointLoginStatus(result?.success ? 'logged-in' : 'logged-out');
      if (!result?.success && result?.error) {
        setSharePointConnectionResult({ success: false, message: result.error });
      }
    } catch {
      setSharePointLoginStatus('logged-out');
      setSharePointConnectionResult({ success: false, message: 'Login failed' });
    }
  };

  const handleSharePointLogout = async () => {
    await window.electronAPI?.sharePointLogout();
    setSharePointLoginStatus('logged-out');
    setSharePointConnectionResult(null);
  };

  const handleTestSharePointConnection = async () => {
    if (!updateSettingsForm.sharePointFolderUrl) return;
    setTestingSharePointConnection(true);
    setSharePointConnectionResult(null);
    try {
      const result = await window.electronAPI?.testSharePointConnection(updateSettingsForm.sharePointFolderUrl);
      setSharePointConnectionResult(result || { success: false, message: 'Test failed' });
    } catch {
      setSharePointConnectionResult({ success: false, message: 'Connection test failed' });
    } finally {
      setTestingSharePointConnection(false);
    }
  };

  const validateSharePointUrl = (url: string): boolean => {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && parsed.hostname.endsWith('.sharepoint.com');
    } catch {
      return false;
    }
  };

  // Dictionary handlers
  const handleSaveDictionarySettings = async () => {
    // Save to context (just the form state - no scheduler logic needed)
    updateLocalDictionary(localDictionaryForm);

    setSaveSuccess(true);
    if (saveSuccessTimeoutRef.current) {
      clearTimeout(saveSuccessTimeoutRef.current);
    }
    saveSuccessTimeoutRef.current = setTimeout(() => {
      setSaveSuccess(false);
      saveSuccessTimeoutRef.current = null;
    }, 2000);
  };

  // Interactive dictionary retrieval from SharePoint using browser login
  const handleRetrieveDictionary = async () => {
    if (typeof window.electronAPI === 'undefined') return;
    if (!localDictionaryForm.sharePointFileUrl.trim()) return;

    setSyncingDictionary(true);
    setDictionaryStatus((prev) => prev ? { ...prev, syncError: null, syncInProgress: true } : null);

    try {
      // Initialize database first if needed
      await window.electronAPI.dictionary.initialize();

      // Retrieve dictionary using interactive SharePoint auth
      const result = await window.electronAPI.dictionary.retrieveFromSharePoint(
        localDictionaryForm.sharePointFileUrl
      );

      if (result.success) {
        // Update form with retrieval info
        const now = new Date().toISOString();
        setLocalDictionaryForm((prev) => ({
          ...prev,
          lastRetrievalTime: now,
          lastRetrievalSuccess: true,
          totalEntries: result.entriesImported || 0,
        }));
        // Also save to context
        updateLocalDictionary({
          ...localDictionaryForm,
          lastRetrievalTime: now,
          lastRetrievalSuccess: true,
          totalEntries: result.entriesImported || 0,
        });
        setDictionaryStatus((prev) =>
          prev ? {
            ...prev,
            lastSyncTime: now,
            lastSyncSuccess: true,
            totalEntries: result.entriesImported || 0,
            syncInProgress: false,
            syncError: null,
          } : null
        );
      } else {
        setDictionaryStatus((prev) =>
          prev ? {
            ...prev,
            syncError: result.error || 'Retrieval failed',
            syncInProgress: false,
            lastSyncSuccess: false,
          } : null
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Retrieval failed';
      setDictionaryStatus((prev) =>
        prev ? { ...prev, syncError: message, syncInProgress: false } : null
      );
    } finally {
      setSyncingDictionary(false);
    }
  };

  const handleSaveBackupSettings = () => {
    updateBackupSettings(backupSettingsForm);
    setSaveSuccess(true);
    if (saveSuccessTimeoutRef.current) {
      clearTimeout(saveSuccessTimeoutRef.current);
    }
    saveSuccessTimeoutRef.current = setTimeout(() => {
      setSaveSuccess(false);
      saveSuccessTimeoutRef.current = null;
    }, 2000);
  };

  const handleExport = async () => {
    try {
      if (!window.electronAPI?.exportSettings) {
        console.warn('Settings: electronAPI.exportSettings not available');
        return;
      }

      // Show save dialog
      const result = await window.electronAPI.exportSettings();

      if (!result.success || result.canceled) {
        return;
      }

      // Prepare export data
      const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        data: {
          userSettings: settings,
          themeSettings: {
            theme,
            density,
            accentColor,
            blur,
          },
          sessions,
          globalStats: stats,
        },
      };

      // Save data to selected file
      const saveResult = await window.electronAPI.saveExportData(result.filePath!, exportData);

      if (saveResult.success) {
        setSaveSuccess(true);
        if (saveSuccessTimeoutRef.current) {
          clearTimeout(saveSuccessTimeoutRef.current);
        }
        saveSuccessTimeoutRef.current = setTimeout(() => {
          setSaveSuccess(false);
          saveSuccessTimeoutRef.current = null;
        }, 2000);
      } else {
        logger.error('Failed to save export data:', saveResult.error);
      }
    } catch (_error) {
      logger.error('Export failed:', _error);
    }
  };

  const handleImport = async () => {
    try {
      if (!window.electronAPI?.importSettings) {
        console.warn('Settings: electronAPI.importSettings not available');
        return;
      }

      // Show open dialog and read data
      const result = await window.electronAPI.importSettings();

      if (!result.success || result.canceled) {
        return;
      }

      // Validate import data
      if (!result.data?.version || !result.data?.data) {
        logger.error('Invalid import file format');
        return;
      }

      const importedData = result.data.data;

      // Apply imported settings (would need to add methods to each context)
      if (importedData.userSettings) {
        updateSettings(importedData.userSettings);
      }

      // Show success message
      setSaveSuccess(true);
      if (saveSuccessTimeoutRef.current) {
        clearTimeout(saveSuccessTimeoutRef.current);
      }
      saveSuccessTimeoutRef.current = setTimeout(() => {
        setSaveSuccess(false);
        saveSuccessTimeoutRef.current = null;
        // Reload page to apply all changes
        window.location.reload();
      }, 2000);
    } catch (_error) {
      logger.error('Import failed:', _error);
    }
  };

  const {
    theme,
    setTheme,
    accentColor,
    setAccentColor,
    customAccentColor,
    setCustomAccentColor,
    customPrimaryColor,
    setCustomPrimaryColor,
    customBackgroundColor,
    setCustomBackgroundColor,
    customHeaderColor,
    setCustomHeaderColor,
    customSidebarColor,
    setCustomSidebarColor,
    customBorderColor,
    setCustomBorderColor,
    useCustomColors,
    setUseCustomColors,
    density,
    setDensity,
    animations,
    setAnimations,
    blur,
    setBlur,
    reduceMotion,
    setReduceMotion,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    fontWeight,
    setFontWeight,
    fontStyle,
    setFontStyle,
    letterSpacing,
    setLetterSpacing,
    lineHeight,
    setLineHeight,
  } = useTheme();

  const [activeColorPicker, setActiveColorPicker] = useState<string | null>(null);
  const [tempColor, setTempColor] = useState('#000000');

  // URL validation states
  const [urlValidation, setUrlValidation] = useState<{
    valid: boolean;
    issues: string[];
    warnings: string[];
  } | null>(null);
  const [showUrlWarning, setShowUrlWarning] = useState(false);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.3 },
    },
  };

  return (
    <motion.div
      className="p-6 max-w-7xl mx-auto"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <div className="flex gap-8">
        <motion.aside className="w-64 shrink-0" variants={itemVariants}>
          <div className="sticky top-6">
            {/* Search */}
            <div className="relative mb-6">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search settings..."
                className="w-full pl-10 pr-3 py-2 text-sm rounded-lg border border-border bg-background text-muted-foreground placeholder:text-muted-foreground/50 hover:border-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
              />
            </div>

            {/* Navigation */}
            <nav className="space-y-6">
              {settingsSections.map((group, groupIndex) => (
                <div key={group.group}>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    {group.group}
                  </h3>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          onClick={() => setActiveSection(item.id)}
                          className={cn(
                            'w-full flex items-start gap-3 px-3 py-2.5 rounded-lg transition-all group',
                            activeSection === item.id
                              ? 'bg-primary/10 text-primary'
                              : 'hover:bg-muted text-foreground'
                          )}
                        >
                          <Icon
                            className={cn(
                              'w-4 h-4 mt-0.5 transition-colors',
                              activeSection === item.id
                                ? 'text-primary'
                                : 'text-muted-foreground group-hover:text-foreground'
                            )}
                          />
                          <div className="text-left">
                            <div className="text-sm font-medium">{item.label}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {item.description}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {groupIndex < settingsSections.length - 1 && (
                    <div className="mt-4 border-b border-border" />
                  )}
                </div>
              ))}
            </nav>
          </div>
        </motion.aside>

        <motion.main className="flex-1 max-w-4xl" variants={itemVariants}>
          {activeSection === 'profile' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Profile</h2>
                <p className="text-muted-foreground mt-1">
                  Manage your personal information and account details
                </p>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="First Name"
                    value={profileForm.firstName}
                    onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })}
                  />
                  <Input
                    label="Last Name"
                    value={profileForm.lastName}
                    onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })}
                  />
                </div>
                <Input
                  label="Email"
                  type="email"
                  value={profileForm.email}
                  onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    icon={<Download className="w-4 h-4" />}
                    onClick={handleExport}
                  >
                    Export Settings
                  </Button>
                  <Button
                    variant="outline"
                    icon={<Download className="w-4 h-4" style={{ transform: 'rotate(180deg)' }} />}
                    onClick={handleImport}
                  >
                    Import Settings
                  </Button>
                  <Button
                    onClick={handleSaveSettings}
                    showSuccess={saveSuccess}
                    icon={<Save className="w-4 h-4" />}
                  >
                    Save Changes
                  </Button>
                </div>
              </div>

              {/* Reset Statistics */}
              <div className="pt-6 border-t border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-destructive">Reset Analytics Statistics</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Permanently delete all historical analytics data. This action cannot be undone.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={() => setShowResetStatsDialog(true)}
                    icon={<RotateCcw className="w-4 h-4" />}
                  >
                    Reset Stats
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'appearance' && (
            <div className="space-y-6">
              {/* Header */}
              <div>
                <h2 className="text-2xl font-bold">Appearance</h2>
                <p className="text-muted-foreground mt-1">
                  Customize the visual appearance of the application
                </p>
              </div>

              {/* Theme & Display Card */}
              <div className="rounded-xl border border-border bg-card p-6 space-y-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-primary/10">
                    <Palette className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Theme & Display</h3>
                    <p className="text-sm text-muted-foreground">Choose your preferred theme and interface density</p>
                  </div>
                </div>

                <div className="space-y-5">
                  {/* Theme Mode */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <label className="text-sm font-medium">Theme Mode</label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Select light, dark, or follow system preference
                      </p>
                    </div>
                    <SegmentedControl
                      value={theme}
                      onValueChange={setTheme}
                      options={[
                        { value: 'light' as const, label: 'Light', icon: Sun },
                        { value: 'dark' as const, label: 'Dark', icon: Moon },
                        { value: 'system' as const, label: 'System', icon: Laptop },
                      ]}
                      size="sm"
                    />
                  </div>

                  <div className="border-t border-border" />

                  {/* Interface Density */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <label className="text-sm font-medium">Interface Density</label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Adjust spacing and element sizes
                      </p>
                    </div>
                    <SegmentedControl
                      value={density}
                      onValueChange={setDensity}
                      options={[
                        { value: 'comfortable' as const, label: 'Comfortable' },
                        { value: 'compact' as const, label: 'Compact' },
                        { value: 'minimal' as const, label: 'Minimal' },
                      ]}
                      size="sm"
                    />
                  </div>
                </div>
              </div>

              {/* Colors Card */}
              <div className="rounded-xl border border-border bg-card p-6 space-y-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-primary/10">
                    <Sparkles className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Colors</h3>
                    <p className="text-sm text-muted-foreground">Customize your accent color and theme</p>
                  </div>
                </div>

                {/* Accent Color */}
                <div>
                  <label className="text-sm font-medium mb-3 block">Accent Color</label>
                  <div className="flex flex-wrap gap-3">
                    {[
                      { name: 'blue' as const, label: 'Blue', color: '#3b82f6' },
                      { name: 'purple' as const, label: 'Purple', color: '#8b5cf6' },
                      { name: 'green' as const, label: 'Green', color: '#22c55e' },
                      { name: 'orange' as const, label: 'Orange', color: '#f97316' },
                      { name: 'pink' as const, label: 'Pink', color: '#ec4899' },
                      { name: 'cyan' as const, label: 'Cyan', color: '#06b6d4' },
                      { name: 'indigo' as const, label: 'Indigo', color: '#6366f1' },
                    ].map((colorOption) => (
                      <motion.button
                        key={colorOption.name}
                        onClick={() => setAccentColor(colorOption.name)}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className={cn(
                          'group relative flex items-center gap-2 px-3 py-2 rounded-full border-2 transition-all',
                          accentColor === colorOption.name
                            ? 'border-primary bg-primary/10 shadow-sm'
                            : 'border-border hover:border-muted-foreground bg-background'
                        )}
                        aria-label={`Select ${colorOption.label} accent`}
                      >
                        <div
                          className="w-4 h-4 rounded-full shadow-inner"
                          style={{ backgroundColor: colorOption.color }}
                        />
                        <span className="text-xs font-medium">{colorOption.label}</span>
                        {accentColor === colorOption.name && (
                          <Check className="w-3 h-3 text-primary" />
                        )}
                      </motion.button>
                    ))}
                    <motion.button
                      onClick={() => {
                        setAccentColor('custom');
                        setTempColor(customAccentColor);
                        setActiveColorPicker('accent');
                      }}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={cn(
                        'group relative flex items-center gap-2 px-3 py-2 rounded-full border-2 transition-all',
                        accentColor === 'custom'
                          ? 'border-primary bg-primary/10 shadow-sm'
                          : 'border-border hover:border-muted-foreground bg-background'
                      )}
                      aria-label="Select custom accent color"
                    >
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{
                          background: accentColor === 'custom'
                            ? customAccentColor
                            : 'conic-gradient(from 180deg, #ef4444, #f59e0b, #22c55e, #3b82f6, #8b5cf6, #ec4899, #ef4444)',
                        }}
                      />
                      <span className="text-xs font-medium">Custom</span>
                      {accentColor === 'custom' && (
                        <Check className="w-3 h-3 text-primary" />
                      )}
                    </motion.button>
                  </div>
                </div>

                {/* Custom Theme Colors - Collapsible */}
                <div className="border-t border-border pt-5">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setUseCustomColors(!useCustomColors)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setUseCustomColors(!useCustomColors);
                      }
                    }}
                    className="flex items-center justify-between w-full group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">Advanced: Custom Theme Colors</span>
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-muted-foreground uppercase tracking-wide">
                        Advanced
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch.Root
                        checked={useCustomColors}
                        onCheckedChange={setUseCustomColors}
                        className={cn(
                          'relative w-10 h-5 rounded-full transition-colors',
                          useCustomColors ? 'bg-primary' : 'bg-input border border-border'
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Switch.Thumb
                          className={cn(
                            'block w-4 h-4 bg-background rounded-full shadow-sm transition-transform',
                            useCustomColors ? 'translate-x-5' : 'translate-x-0.5'
                          )}
                        />
                      </Switch.Root>
                      <ChevronDown
                        className={cn(
                          'w-4 h-4 text-muted-foreground transition-transform',
                          useCustomColors && 'rotate-180'
                        )}
                      />
                    </div>
                  </div>

                  {useCustomColors && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="mt-4"
                    >
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        {[
                          { key: 'primary', label: 'Primary', color: customPrimaryColor, setter: setCustomPrimaryColor, showTextHint: true },
                          { key: 'background', label: 'Background', color: customBackgroundColor, setter: setCustomBackgroundColor, showTextHint: true },
                          { key: 'header', label: 'Header', color: customHeaderColor, setter: setCustomHeaderColor, showTextHint: true },
                          { key: 'sidebar', label: 'Sidebar', color: customSidebarColor, setter: setCustomSidebarColor, showTextHint: true },
                          { key: 'border', label: 'Borders', color: customBorderColor, setter: setCustomBorderColor },
                        ].map((item) => (
                          <div key={item.key}>
                            <label className="text-xs text-muted-foreground mb-1.5 block">{item.label}</label>
                            <button
                              aria-label={`Select ${item.label.toLowerCase()} color`}
                              onClick={() => {
                                setTempColor(item.color);
                                setActiveColorPicker(item.key);
                              }}
                              className="w-full h-10 rounded-lg border border-border flex items-center justify-center gap-2 hover:bg-muted/50 transition-colors group"
                            >
                              <div
                                className="w-6 h-6 rounded-md shadow-inner group-hover:scale-110 transition-transform"
                                style={{ backgroundColor: item.color }}
                              />
                            </button>
                            {item.showTextHint && (
                              <p className="text-[10px] text-muted-foreground mt-1 text-center">
                                Text: {getContrastTextColor(item.color) === '#FFFFFF' ? 'White' : 'Black'}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>

              {/* Visual Effects Card */}
              <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2.5 rounded-lg bg-primary/10">
                    <Zap className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Visual Effects</h3>
                    <p className="text-sm text-muted-foreground">Control animations and visual enhancements</p>
                  </div>
                </div>

                <div className="space-y-1 divide-y divide-border">
                  <SettingRow
                    icon={Sparkles}
                    title="Glass morphism effects"
                    description="Blur and transparency for a modern look"
                  >
                    <Switch.Root
                      checked={blur}
                      onCheckedChange={setBlur}
                      className={cn(
                        'relative w-10 h-5 rounded-full transition-colors',
                        blur ? 'bg-primary' : 'bg-input border border-border'
                      )}
                    >
                      <Switch.Thumb
                        className={cn(
                          'block w-4 h-4 bg-background rounded-full shadow-sm transition-transform',
                          blur ? 'translate-x-5' : 'translate-x-0.5'
                        )}
                      />
                    </Switch.Root>
                  </SettingRow>

                  <SettingRow
                    icon={Zap}
                    title="Smooth animations"
                    description="Transitions and micro-interactions"
                  >
                    <Switch.Root
                      checked={animations}
                      onCheckedChange={setAnimations}
                      className={cn(
                        'relative w-10 h-5 rounded-full transition-colors',
                        animations ? 'bg-primary' : 'bg-input border border-border'
                      )}
                    >
                      <Switch.Thumb
                        className={cn(
                          'block w-4 h-4 bg-background rounded-full shadow-sm transition-transform',
                          animations ? 'translate-x-5' : 'translate-x-0.5'
                        )}
                      />
                    </Switch.Root>
                  </SettingRow>

                  <SettingRow
                    icon={Accessibility}
                    title="Reduce motion"
                    description="Minimize animations for accessibility"
                  >
                    <Switch.Root
                      checked={reduceMotion}
                      onCheckedChange={setReduceMotion}
                      className={cn(
                        'relative w-10 h-5 rounded-full transition-colors',
                        reduceMotion ? 'bg-primary' : 'bg-input border border-border'
                      )}
                    >
                      <Switch.Thumb
                        className={cn(
                          'block w-4 h-4 bg-background rounded-full shadow-sm transition-transform',
                          reduceMotion ? 'translate-x-5' : 'translate-x-0.5'
                        )}
                      />
                    </Switch.Root>
                  </SettingRow>
                </div>

                <p className="text-xs text-muted-foreground pt-2">
                  Disabling visual effects can improve performance on slower systems.
                </p>
              </div>
            </div>
          )}

          {activeSection === 'typography' && (
            <div className="space-y-6">
              {/* Header */}
              <div>
                <h2 className="text-2xl font-bold">Typography</h2>
                <p className="text-muted-foreground mt-1">
                  Customize fonts and text styling throughout the application
                </p>
              </div>

              {/* Live Preview */}
              <div className="p-6 rounded-lg border border-border bg-muted/30">
                <div className="space-y-3">
                  {}
                  <h3
                    className="text-lg font-semibold"
                    style={{
                      fontSize: `${fontSize * 1.2}px`,
                      fontFamily: fontFamily,
                      fontWeight: fontWeight,
                      fontStyle: fontStyle,
                      letterSpacing: `${letterSpacing}em`,
                      lineHeight: lineHeight,
                    }}
                  >
                    Preview: Main Heading
                  </h3>
                  {}
                  <p
                    style={{
                      fontSize: `${fontSize}px`,
                      fontFamily: fontFamily,
                      fontWeight: fontWeight,
                      fontStyle: fontStyle,
                      letterSpacing: `${letterSpacing}em`,
                      lineHeight: lineHeight,
                    }}
                  >
                    This is a preview of your typography settings. The quick brown fox jumps over
                    the lazy dog. Adjust the settings below to see how your text will appear
                    throughout the application.
                  </p>
                  {}
                  <p
                    className="text-muted-foreground"
                    style={{
                      fontSize: `${fontSize * 0.875}px`,
                      fontFamily: fontFamily,
                      letterSpacing: `${letterSpacing}em`,
                      lineHeight: lineHeight,
                    }}
                  >
                    Secondary text appears like this, used for descriptions and supporting content.
                  </p>
                </div>
              </div>

              {/* Presets */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Quick Presets
                </h3>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => {
                      setFontSize(16);
                      setFontFamily("'Inter', sans-serif");
                      setFontWeight('400');
                      setLetterSpacing(0.02);
                      setLineHeight(1.7);
                    }}
                    aria-label="Apply reading typography preset"
                    className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Reading
                  </button>
                  <button
                    onClick={() => {
                      setFontSize(14);
                      setFontFamily('system-ui');
                      setFontWeight('400');
                      setLetterSpacing(0);
                      setLineHeight(1.4);
                    }}
                    aria-label="Apply compact typography preset"
                    className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Compact
                  </button>
                  <button
                    onClick={() => {
                      setFontSize(18);
                      setFontFamily("'Poppins', sans-serif");
                      setFontWeight('500');
                      setLetterSpacing(0.01);
                      setLineHeight(1.6);
                    }}
                    aria-label="Apply presentation typography preset"
                    className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Presentation
                  </button>
                  <button
                    onClick={() => {
                      setFontSize(15);
                      setFontFamily('system-ui');
                      setFontWeight('400');
                      setFontStyle('normal');
                      setLetterSpacing(0);
                      setLineHeight(1.5);
                    }}
                    aria-label="Apply default typography preset"
                    className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                  >
                    Default
                  </button>
                </div>
              </div>

              {/* Settings */}
              <div className="grid grid-cols-2 gap-6">
                {/* Font Settings */}
                <div className="space-y-4">
                  <h3 className="font-medium">Font</h3>

                  <div>
                    <label
                      htmlFor="font-family-select"
                      className="text-sm text-muted-foreground mb-2 block"
                    >
                      Family
                    </label>
                    <select
                      id="font-family-select"
                      value={fontFamily}
                      onChange={(e) => setFontFamily(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                    >
                      <option value="system-ui">System Default</option>
                      <option value="'Inter', sans-serif">Inter</option>
                      <option value="'Roboto', sans-serif">Roboto</option>
                      <option value="'Open Sans', sans-serif">Open Sans</option>
                      <option value="'Lato', sans-serif">Lato</option>
                      <option value="'Poppins', sans-serif">Poppins</option>
                      <option value="'SF Pro Display', sans-serif">SF Pro</option>
                      <option value="'Segoe UI', sans-serif">Segoe UI</option>
                      <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
                      <option value="'Fira Code', monospace">Fira Code</option>
                      <option value="'Webdings', fantasy">Webdings 🎉</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">Size</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="12"
                        max="20"
                        value={fontSize}
                        onChange={(e) => setFontSize(Number(e.target.value))}
                        aria-label="Font size"
                        className="flex-1"
                      />
                      <span className="text-sm font-mono w-12 text-center bg-muted rounded px-2 py-1">
                        {fontSize}px
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-foreground mb-2 block">Weight</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { value: '300', label: 'Light' },
                        { value: '400', label: 'Regular' },
                        { value: '500', label: 'Medium' },
                        { value: '600', label: 'Semibold' },
                        { value: '700', label: 'Bold' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setFontWeight(option.value)}
                          aria-label={`Set font weight to ${option.label}`}
                          className={cn(
                            'px-2 py-1.5 text-sm rounded transition-colors',
                            fontWeight === option.value
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-muted'
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-foreground mb-2 block">Style</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setFontStyle('normal')}
                        aria-label="Set font style to normal"
                        className={cn(
                          'px-3 py-2 rounded-lg border transition-all text-sm',
                          fontStyle === 'normal'
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:bg-muted'
                        )}
                      >
                        Normal
                      </button>
                      <button
                        onClick={() => setFontStyle('italic')}
                        aria-label="Set font style to italic"
                        className={cn(
                          'px-3 py-2 rounded-lg border transition-all text-sm italic',
                          fontStyle === 'italic'
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:bg-muted'
                        )}
                      >
                        Italic
                      </button>
                    </div>
                  </div>
                </div>

                {/* Spacing Settings */}
                <div className="space-y-4">
                  <h3 className="font-medium">Spacing</h3>

                  <div>
                    <label className="text-sm text-foreground mb-2 block">Letter Spacing</label>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">Tight</span>
                      <input
                        type="range"
                        min="-0.05"
                        max="0.1"
                        step="0.01"
                        value={letterSpacing}
                        onChange={(e) => setLetterSpacing(Number(e.target.value))}
                        aria-label="Letter spacing"
                        className="flex-1"
                      />
                      <span className="text-xs text-muted-foreground">Wide</span>
                      <span className="text-sm font-mono w-16 text-center bg-muted rounded px-2 py-1">
                        {letterSpacing.toFixed(2)}em
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-foreground mb-2 block">Line Height</label>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">Compact</span>
                      <input
                        type="range"
                        min="1"
                        max="2"
                        step="0.1"
                        value={lineHeight}
                        onChange={(e) => setLineHeight(Number(e.target.value))}
                        aria-label="Line height"
                        className="flex-1"
                      />
                      <span className="text-xs text-muted-foreground">Spacious</span>
                      <span className="text-sm font-mono w-12 text-center bg-muted rounded px-2 py-1">
                        {lineHeight.toFixed(1)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'display' && (
            <div className="space-y-6">
              {/* Header */}
              <div>
                <h2 className="text-2xl font-bold">Display</h2>
                <p className="text-muted-foreground mt-1">
                  Configure monitor settings for document comparison
                </p>
              </div>

              {/* Monitor Selection */}
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-4">Monitor for Comparing Files</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Select which monitor to use when comparing documents side by side
                  </p>

                  <div className="flex flex-col sm:flex-row gap-4 items-start">
                    <div className="flex-1">
                      <label htmlFor="comparison-monitor" className="block text-sm font-medium mb-2">
                        Select Monitor
                      </label>
                      <select
                        id="comparison-monitor"
                        value={displaySettingsForm?.comparisonMonitorId ?? 0}
                        onChange={(e) => setDisplaySettingsForm((prev) => ({
                          ...prev,
                          comparisonMonitorId: parseInt(e.target.value, 10),
                        }))}
                        className="w-full px-3 py-2 rounded-md border border-input bg-background"
                      >
                        {availableDisplays.length > 0 ? (
                          availableDisplays.map((display) => (
                            <option key={display.id} value={display.id}>
                              {display.label} ({display.workArea.width} x {display.workArea.height})
                            </option>
                          ))
                        ) : (
                          <option value={0}>Primary (loading...)</option>
                        )}
                      </select>
                    </div>

                    <div className="pt-6">
                      <Button
                        variant="outline"
                        onClick={async () => {
                          if (typeof window.electronAPI === 'undefined' || !window.electronAPI.display) return;
                          setIdentifyingMonitors(true);
                          try {
                            await window.electronAPI.display.identifyMonitors();
                          } finally {
                            // The identification windows close automatically after 3 seconds
                            setTimeout(() => setIdentifyingMonitors(false), 3000);
                          }
                        }}
                        disabled={identifyingMonitors}
                      >
                        {identifyingMonitors ? (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                            Identifying...
                          </>
                        ) : (
                          <>
                            <Monitor className="w-4 h-4 mr-2" />
                            Identify Monitors
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground mt-2">
                    Click "Identify Monitors" to display a number on each connected monitor for 3 seconds
                  </p>
                </div>

                {/* Save Button */}
                <div className="pt-4 border-t">
                  <Button
                    onClick={() => {
                      updateDisplaySettings(displaySettingsForm);
                      setSaveSuccess(true);
                      if (saveSuccessTimeoutRef.current) {
                        clearTimeout(saveSuccessTimeoutRef.current);
                      }
                      saveSuccessTimeoutRef.current = setTimeout(() => {
                        setSaveSuccess(false);
                      }, 2000);
                    }}
                    showSuccess={saveSuccess}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Save Display Settings
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'language' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Language & Region</h2>
                <p className="text-muted-foreground mt-1">
                  Set your language, timezone, and regional preferences
                </p>
              </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="language-select" className="block text-sm font-medium mb-2">
                    Language
                  </label>
                  <select
                    id="language-select"
                    value={languageForm}
                    onChange={(e) => setLanguageForm(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background"
                  >
                    <option>English (US)</option>
                    <option>Español (Spanish)</option>
                    <option>中文 (Mandarin Chinese)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="timezone-select" className="block text-sm font-medium mb-2">
                    Timezone
                  </label>
                  <select
                    id="timezone-select"
                    value={timezoneForm}
                    onChange={(e) => setTimezoneForm(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background"
                  >
                    <optgroup label="United States">
                      <option>UTC-10:00 Hawaii-Aleutian</option>
                      <option>UTC-09:00 Alaska</option>
                      <option>UTC-08:00 Pacific Time (PT)</option>
                      <option>UTC-07:00 Mountain Time (MT)</option>
                      <option>UTC-06:00 Central Time (CT)</option>
                      <option>UTC-05:00 Eastern Time (ET)</option>
                    </optgroup>
                    <optgroup label="Common International">
                      <option>UTC+00:00 Coordinated Universal Time</option>
                      <option>UTC+00:00 London (GMT)</option>
                      <option>UTC+01:00 Paris/Berlin (CET)</option>
                      <option>UTC+02:00 Cairo/Athens</option>
                      <option>UTC+03:00 Moscow/Istanbul</option>
                      <option>UTC+05:30 Mumbai/Delhi</option>
                      <option>UTC+08:00 Beijing/Singapore</option>
                      <option>UTC+09:00 Tokyo/Seoul</option>
                      <option>UTC+10:00 Sydney</option>
                    </optgroup>
                  </select>
                </div>

                <div>
                  <label htmlFor="date-format-select" className="block text-sm font-medium mb-2">
                    Date Format
                  </label>
                  <select
                    id="date-format-select"
                    value={dateFormatForm}
                    onChange={(e) => setDateFormatForm(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background"
                  >
                    <option>MM/DD/YYYY</option>
                    <option>DD/MM/YYYY</option>
                    <option>YYYY-MM-DD</option>
                  </select>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveSettings}
                    showSuccess={saveSuccess}
                    icon={<Save className="w-4 h-4" />}
                  >
                    Save Settings
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'updates' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Updates</h2>
                <p className="text-muted-foreground mt-1">
                  Manage application updates and versioning
                </p>
              </div>

              <div className="space-y-6">
                <div className="p-4 bg-muted/20 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">Current Version</h3>
                      <p className="text-sm text-muted-foreground">
                        {currentVersion || 'Loading...'}
                      </p>
                    </div>
                    <Button
                      onClick={handleCheckForUpdates}
                      disabled={checkingForUpdates}
                      icon={
                        <RefreshCw
                          className={cn('w-4 h-4', checkingForUpdates && 'animate-spin')}
                        />
                      }
                    >
                      {checkingForUpdates ? 'Checking...' : 'Check for Updates'}
                    </Button>
                  </div>
                  {updateStatus && <p className="text-sm text-muted-foreground">{updateStatus}</p>}
                  {updateAvailable && !updateDownloaded && (
                    <Button
                      onClick={handleDownloadUpdate}
                      variant="default"
                      className="w-full"
                      disabled={downloadProgress > 0 && downloadProgress < 100}
                    >
                      {downloadProgress > 0
                        ? `Downloading ${Math.round(downloadProgress)}%`
                        : `Download Update ${updateVersion}`}
                    </Button>
                  )}
                  {downloadProgress > 0 && downloadProgress < 100 && (
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: `${downloadProgress}%` }}
                      />
                    </div>
                  )}
                  {updateDownloaded && (
                    <Button
                      onClick={handleInstallUpdate}
                      variant="default"
                      className="w-full bg-green-600 hover:bg-green-700"
                    >
                      Install & Restart
                    </Button>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <label htmlFor="auto-update" className="text-sm font-medium">
                        Auto-update on launch
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Automatically check for updates when the application starts
                      </p>
                    </div>
                    <button
                      id="auto-update"
                      role="switch"
                      aria-checked={updateSettingsForm.autoUpdateOnLaunch}
                      onClick={() =>
                        setUpdateSettingsForm({
                          ...updateSettingsForm,
                          autoUpdateOnLaunch: !updateSettingsForm.autoUpdateOnLaunch,
                        })
                      }
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors border-2',
                        updateSettingsForm.autoUpdateOnLaunch
                          ? 'bg-primary border-primary toggle-checked'
                          : 'bg-input border-border'
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                          updateSettingsForm.autoUpdateOnLaunch ? 'translate-x-6' : 'translate-x-1'
                        )}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <label htmlFor="pre-releases" className="text-sm font-medium">
                        Check for pre-releases
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Include beta and pre-release versions in update checks
                      </p>
                    </div>
                    <button
                      id="pre-releases"
                      role="switch"
                      aria-checked={updateSettingsForm.checkForPreReleases}
                      onClick={() =>
                        setUpdateSettingsForm({
                          ...updateSettingsForm,
                          checkForPreReleases: !updateSettingsForm.checkForPreReleases,
                        })
                      }
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors border-2',
                        updateSettingsForm.checkForPreReleases
                          ? 'bg-primary border-primary toggle-checked'
                          : 'bg-input border-border'
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                          updateSettingsForm.checkForPreReleases ? 'translate-x-6' : 'translate-x-1'
                        )}
                      />
                    </button>
                  </div>
                </div>

                {/* SharePoint Update Source */}
                <div className="border border-border rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <label htmlFor="use-sharepoint" className="text-sm font-medium flex items-center gap-2">
                        <Cloud className="w-4 h-4" />
                        Use SharePoint for Updates
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Download updates from a SharePoint folder instead of GitHub
                      </p>
                    </div>
                    <button
                      id="use-sharepoint"
                      role="switch"
                      aria-checked={updateSettingsForm.useSharePointSource}
                      onClick={() =>
                        setUpdateSettingsForm({
                          ...updateSettingsForm,
                          useSharePointSource: !updateSettingsForm.useSharePointSource,
                        })
                      }
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors border-2',
                        updateSettingsForm.useSharePointSource
                          ? 'bg-primary border-primary toggle-checked'
                          : 'bg-input border-border'
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                          updateSettingsForm.useSharePointSource ? 'translate-x-6' : 'translate-x-1'
                        )}
                      />
                    </button>
                  </div>

                  {updateSettingsForm.useSharePointSource && (
                    <div className="space-y-4 pt-2 border-t border-border">
                      {/* SharePoint Folder URL */}
                      <div>
                        <label htmlFor="sp-url" className="block text-sm font-medium mb-2">
                          SharePoint Folder URL
                        </label>
                        <input
                          id="sp-url"
                          type="url"
                          value={updateSettingsForm.sharePointFolderUrl || ''}
                          onChange={(e) =>
                            setUpdateSettingsForm({
                              ...updateSettingsForm,
                              sharePointFolderUrl: e.target.value,
                            })
                          }
                          placeholder="https://company.sharepoint.com/sites/IT/Shared Documents/Updates"
                          className={cn(
                            'w-full px-3 py-2 rounded-md border bg-background focus:outline-none focus:ring-1',
                            updateSettingsForm.sharePointFolderUrl && !validateSharePointUrl(updateSettingsForm.sharePointFolderUrl)
                              ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                              : 'border-input focus:border-primary focus:ring-primary/20'
                          )}
                        />
                        {updateSettingsForm.sharePointFolderUrl && !validateSharePointUrl(updateSettingsForm.sharePointFolderUrl) && (
                          <p className="text-xs text-red-500 mt-1">
                            Invalid URL. Must be https://*.sharepoint.com/sites/...
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          Folder must contain: latest.yml and the MSI installer file
                        </p>
                      </div>

                      {/* Microsoft Login */}
                      <div className="flex items-center gap-3">
                        {sharePointLoginStatus !== 'logged-in' ? (
                          <Button
                            variant="outline"
                            onClick={handleSharePointLogin}
                            disabled={sharePointLoginStatus === 'logging-in'}
                            icon={<User className="w-4 h-4" />}
                          >
                            {sharePointLoginStatus === 'logging-in' ? 'Signing In...' : 'Sign In to Microsoft'}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            onClick={handleSharePointLogout}
                            icon={<LogOut className="w-4 h-4" />}
                          >
                            Sign Out
                          </Button>
                        )}

                        {sharePointLoginStatus === 'logged-in' && (
                          <span className="text-xs text-green-500 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Authenticated
                          </span>
                        )}
                      </div>

                      {/* Test Connection */}
                      <div className="flex items-center gap-3">
                        <Button
                          variant="outline"
                          onClick={handleTestSharePointConnection}
                          disabled={
                            testingSharePointConnection ||
                            !updateSettingsForm.sharePointFolderUrl ||
                            sharePointLoginStatus !== 'logged-in'
                          }
                          icon={<Wifi className="w-4 h-4" />}
                        >
                          {testingSharePointConnection ? 'Testing...' : 'Test Connection'}
                        </Button>

                        {sharePointConnectionResult && (
                          <span
                            className={cn(
                              'text-xs flex items-center gap-1',
                              sharePointConnectionResult.success ? 'text-green-500' : 'text-red-500'
                            )}
                          >
                            {sharePointConnectionResult.success ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <AlertCircle className="w-3 h-3" />
                            )}
                            {sharePointConnectionResult.message}
                          </span>
                        )}
                      </div>

                      {/* Info */}
                      <p className="text-xs text-muted-foreground bg-muted/20 p-2 rounded">
                        GitHub remains the default update source. SharePoint is only used when enabled with a valid URL
                        and you&apos;re signed in. If SharePoint fails, the app will automatically fall back to GitHub.
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveSettings}
                    showSuccess={saveSuccess}
                    icon={<Save className="w-4 h-4" />}
                  >
                    Save Settings
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'api-connections' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">API Connections</h2>
                <p className="text-muted-foreground mt-1">
                  Configure external service integrations and API endpoints
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-3">Hyperlink Processing</h3>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="powerautomate-url" className="block text-sm font-medium mb-2">
                        PowerAutomate Dictionary URL
                      </label>
                      <div className="relative">
                        <input
                          id="powerautomate-url"
                          type="url"
                          value={apiConnectionsForm.powerAutomateUrl}
                          onChange={(e) => handlePowerAutomateUrlChange(e.target.value)}
                          onPaste={(e) => {
                            // Auto-sanitize on paste
                            if (urlWarningTimeoutRef.current) {
                              clearTimeout(urlWarningTimeoutRef.current);
                            }
                            urlWarningTimeoutRef.current = setTimeout(() => {
                              const pasted = e.currentTarget.value;
                              if (hasEncodingIssues(pasted)) {
                                handlePowerAutomateUrlChange(pasted);
                              }
                              urlWarningTimeoutRef.current = null;
                            }, 10);
                          }}
                          placeholder="https://prod-11.westus.logic.azure.com/workflows/..."
                          className={cn(
                            'w-full px-3 py-2 pr-10 rounded-md border bg-background focus:outline-none focus:ring-1',
                            urlValidation?.valid === false
                              ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                              : urlValidation?.warnings.length
                                ? 'border-yellow-500 focus:border-yellow-500 focus:ring-yellow-500/20'
                                : 'border-input focus:border-primary focus:ring-primary/20'
                          )}
                        />
                        {urlValidation && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            {urlValidation.valid ? (
                              <CheckCircle2 className="w-5 h-5 text-green-500" />
                            ) : (
                              <AlertCircle className="w-5 h-5 text-red-500" />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Validation messages */}
                      {urlValidation && !urlValidation.valid && urlValidation.issues.length > 0 && (
                        <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                            <div className="flex-1 space-y-1">
                              {urlValidation.issues.map((issue, idx) => (
                                <p key={idx} className="text-xs text-red-700 dark:text-red-300">
                                  {issue}
                                </p>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {urlValidation && urlValidation.warnings.length > 0 && (
                        <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                            <div className="flex-1 space-y-1">
                              {urlValidation.warnings.map((warning, idx) => (
                                <p
                                  key={idx}
                                  className="text-xs text-yellow-700 dark:text-yellow-300"
                                >
                                  {warning}
                                </p>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {showUrlWarning && (
                        <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                          <div className="flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                            <p className="text-xs text-blue-700 dark:text-blue-300">
                              URL automatically sanitized! Encoded characters have been fixed.
                            </p>
                          </div>
                        </div>
                      )}

                      <p className="text-xs text-muted-foreground mt-2">
                        This URL is used by the Hyperlink Service to retrieve document metadata and
                        validate links. The service will send collected document IDs to this
                        endpoint and receive enriched data in response.
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-medium mb-3">Feedback & Reporting</h3>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="bug-report-url" className="block text-sm font-medium mb-2">
                        Bug Report API URL
                      </label>
                      <input
                        id="bug-report-url"
                        type="url"
                        value={apiConnectionsForm.bugReportUrl}
                        onChange={(e) =>
                          setApiConnectionsForm({
                            ...apiConnectionsForm,
                            bugReportUrl: e.target.value,
                          })
                        }
                        placeholder="https://www.example.com"
                        className="w-full px-3 py-2 rounded-md border border-input bg-background focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                      />
                      <p className="text-xs text-muted-foreground mt-2">
                        Bug reports will be sent to this API endpoint. Leave as default to use email
                        instead.
                      </p>
                    </div>

                    <div>
                      <label htmlFor="submit-idea-url" className="block text-sm font-medium mb-2">
                        Submit Idea API URL
                      </label>
                      <input
                        id="submit-idea-url"
                        type="url"
                        value={apiConnectionsForm.submitIdeaUrl}
                        onChange={(e) =>
                          setApiConnectionsForm({
                            ...apiConnectionsForm,
                            submitIdeaUrl: e.target.value,
                          })
                        }
                        placeholder="https://www.example.com"
                        className="w-full px-3 py-2 rounded-md border border-input bg-background focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                      />
                      <p className="text-xs text-muted-foreground mt-2">
                        Feature suggestions will be sent to this API endpoint. Leave as default to
                        use email instead.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-border">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Link2 className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">About API Connections</h4>
                      <p className="text-sm text-muted-foreground">
                        API connections allow Documentation Hub to integrate with external services
                        for enhanced functionality. These endpoints are used during document
                        processing to enrich data, validate content, and automate workflows.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveSettings}
                    showSuccess={saveSuccess}
                    icon={<Save className="w-4 h-4" />}
                  >
                    Save Settings
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'submit-idea' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Submit Idea for New Implementation</h2>
                <p className="text-muted-foreground mt-1">
                  Have an idea to improve the application? We'd love to hear from you!
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Title for Idea</label>
                  <input
                    type="text"
                    value={ideaTitle}
                    onChange={(e) => setIdeaTitle(e.target.value)}
                    placeholder="Enter a brief title for your idea"
                    className="w-full px-3 py-2 rounded-md border border-input bg-background"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Why is this needed / Who would this benefit?
                  </label>
                  <textarea
                    value={ideaBenefit}
                    onChange={(e) => setIdeaBenefit(e.target.value)}
                    placeholder="Describe the benefits and potential users of this feature..."
                    rows={6}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background resize-none"
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={async () => {
                      if (!ideaTitle || !ideaBenefit) return;

                      const idea = {
                        Type: 'Feedback',
                        Email: settings.profile.email,
                        Title: ideaTitle,
                        Description: ideaBenefit,
                      };

                      const apiUrl = settings.apiConnections.submitIdeaUrl;

                      // Check if using default URL - if so, fallback to mailto
                      if (apiUrl === 'https://www.example.com' || !apiUrl) {
                        const subject = encodeURIComponent(`Feature Idea: ${ideaTitle}`);
                        const body = encodeURIComponent(`
Feature Idea
------------
Email: ${settings.profile.email}
Title: ${ideaTitle}

Description:
${ideaBenefit}

Submitted: ${new Date().toLocaleString()}
                        `);

                        window.location.href = `mailto:support@example.com?subject=${subject}&body=${body}`;

                        // Clear fields after mailto (assuming success)
                        setIdeaTitle('');
                        setIdeaBenefit('');
                        setIdeaSubmitted(true);
                        if (ideaSubmittedTimeoutRef.current) {
                          clearTimeout(ideaSubmittedTimeoutRef.current);
                        }
                        ideaSubmittedTimeoutRef.current = setTimeout(() => {
                          setIdeaSubmitted(false);
                          ideaSubmittedTimeoutRef.current = null;
                        }, 2000);

                        // Show success notification
                        alert('Your idea has been sent to the Documentation Hub Admin');
                        return;
                      }

                      // Use API if configured
                      try {
                        const response = await fetch(apiUrl, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify(idea),
                        });

                        if (response.ok) {
                          // Only clear fields on success
                          setIdeaTitle('');
                          setIdeaBenefit('');
                          setIdeaSubmitted(true);
                          if (ideaSubmittedTimeoutRef.current) {
                            clearTimeout(ideaSubmittedTimeoutRef.current);
                          }
                          ideaSubmittedTimeoutRef.current = setTimeout(() => {
                            setIdeaSubmitted(false);
                            ideaSubmittedTimeoutRef.current = null;
                          }, 2000);

                          // Show success notification
                          alert('Your idea has been sent to the Documentation Hub Admin');
                        } else {
                          alert('Failed to submit idea. Please try again.');
                        }
                      } catch (_error) {
                        logger.error('Error submitting idea:', _error);
                        alert('Failed to submit idea. Please check your API configuration.');
                      }
                    }}
                    icon={<Send className="w-4 h-4" />}
                    showSuccess={ideaSubmitted}
                    disabled={!ideaTitle || !ideaBenefit}
                  >
                    Submit Idea
                  </Button>
                </div>

                <div className="mt-6 p-4 bg-muted/30 rounded-lg border border-border">
                  <p className="text-sm text-muted-foreground">
                    <strong>Note:</strong> Your ideas help shape the future of Documentation Hub. We
                    review all submissions and prioritize features based on user feedback and
                    technical feasibility.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'local-dictionary' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Local Dictionary</h2>
                <p className="text-muted-foreground mt-1">
                  Configure offline hyperlink lookups using a local SharePoint dictionary
                </p>
              </div>

              <div className="space-y-6">
                {/* Enable/Disable Toggle */}
                <div className="p-4 bg-muted/20 rounded-lg border border-border">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <label htmlFor="dictionary-enabled" className="text-sm font-medium">
                        Enable Local Dictionary
                      </label>
                      <p className="text-xs text-muted-foreground">
                        When enabled, hyperlink lookups will use the local database first, falling back to the API if not found
                      </p>
                    </div>
                    <button
                      id="dictionary-enabled"
                      role="switch"
                      aria-checked={localDictionaryForm.enabled}
                      onClick={() =>
                        setLocalDictionaryForm({
                          ...localDictionaryForm,
                          enabled: !localDictionaryForm.enabled,
                        })
                      }
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors border-2',
                        localDictionaryForm.enabled
                          ? 'bg-primary border-primary toggle-checked'
                          : 'bg-input border-border'
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                          localDictionaryForm.enabled ? 'translate-x-6' : 'translate-x-1'
                        )}
                      />
                    </button>
                  </div>
                </div>

                {/* SharePoint File URL */}
                <div className="space-y-4">
                  <h3 className="font-medium">SharePoint Dictionary File</h3>

                  <div>
                    <label htmlFor="sharepoint-file-url" className="block text-sm font-medium mb-2">
                      SharePoint File URL
                    </label>
                    <input
                      id="sharepoint-file-url"
                      type="url"
                      value={localDictionaryForm.sharePointFileUrl}
                      onChange={(e) =>
                        setLocalDictionaryForm({
                          ...localDictionaryForm,
                          sharePointFileUrl: e.target.value,
                        })
                      }
                      placeholder="https://company.sharepoint.com/sites/IT/Shared Documents/Dictionary.xlsx"
                      className="w-full px-3 py-2 rounded-md border border-input bg-background focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Direct URL to the .xlsx dictionary file on SharePoint (Daily_Inventory sheet, Dictionary_Table table)
                    </p>
                  </div>
                </div>

                {/* Retrieval Status */}
                <div className="p-4 bg-muted/20 rounded-lg border border-border space-y-3">
                  <h3 className="font-medium">Dictionary Status</h3>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Total Entries:</span>
                      <span className="ml-2 font-medium">
                        {localDictionaryForm.totalEntries?.toLocaleString() || dictionaryStatus?.totalEntries?.toLocaleString() || '0'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Last Retrieved:</span>
                      <span className="ml-2 font-medium">
                        {localDictionaryForm.lastRetrievalTime
                          ? new Date(localDictionaryForm.lastRetrievalTime).toLocaleString()
                          : dictionaryStatus?.lastSyncTime
                            ? new Date(dictionaryStatus.lastSyncTime).toLocaleString()
                            : 'Never'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Status:</span>
                      <span
                        className={cn(
                          'ml-2 font-medium',
                          (localDictionaryForm.lastRetrievalSuccess || dictionaryStatus?.lastSyncSuccess) ? 'text-green-600' : 'text-muted-foreground'
                        )}
                      >
                        {dictionaryStatus?.syncInProgress
                          ? 'Retrieving...'
                          : (localDictionaryForm.lastRetrievalSuccess || dictionaryStatus?.lastSyncSuccess)
                            ? 'Ready'
                            : 'Not retrieved'}
                      </span>
                    </div>
                  </div>

                  {/* Progress bar during retrieval */}
                  {dictionaryStatus?.syncInProgress && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Retrieving dictionary...</span>
                        <span>{Math.round(dictionaryStatus.syncProgress || 0)}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${dictionaryStatus.syncProgress || 0}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Error display */}
                  {dictionaryStatus?.syncError && (
                    <div className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-red-700 dark:text-red-300">
                          {dictionaryStatus.syncError}
                        </p>
                      </div>
                    </div>
                  )}

                  <Button
                    variant="outline"
                    onClick={handleRetrieveDictionary}
                    disabled={syncingDictionary || !localDictionaryForm.sharePointFileUrl?.trim()}
                    icon={<RefreshCw className={cn('w-4 h-4', syncingDictionary && 'animate-spin')} />}
                    className="w-full"
                  >
                    {syncingDictionary ? 'Retrieving...' : 'Retrieve Dictionary'}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    Opens browser for Microsoft sign-in, then downloads and imports the dictionary
                  </p>
                </div>

                {/* Info Card */}
                <div className="pt-4 border-t border-border">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <HardDrive className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">About Local Dictionary</h4>
                      <p className="text-sm text-muted-foreground">
                        The local dictionary downloads your SharePoint dictionary file and stores it
                        in a high-performance SQLite database for instant lookups. When enabled,
                        hyperlink lookups check the local database first. If an ID is not found locally,
                        the system automatically falls back to the API for that lookup.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveDictionarySettings}
                    showSuccess={saveSuccess}
                    icon={<Save className="w-4 h-4" />}
                  >
                    Save Settings
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'backup-settings' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Backups</h2>
                <p className="text-muted-foreground mt-1">
                  Configure automatic document backup settings
                </p>
              </div>

              <div className="space-y-6">
                {/* Enable/Disable Toggle */}
                <div className="p-4 bg-muted/20 rounded-lg border border-border">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <label htmlFor="backup-enabled" className="text-sm font-medium">
                        Enable Automatic Backups
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Create backup copies of documents before processing changes
                      </p>
                    </div>
                    <button
                      id="backup-enabled"
                      role="switch"
                      aria-checked={backupSettingsForm.enabled}
                      onClick={() =>
                        setBackupSettingsForm({
                          ...backupSettingsForm,
                          enabled: !backupSettingsForm.enabled,
                        })
                      }
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors border-2',
                        backupSettingsForm.enabled
                          ? 'bg-primary border-primary toggle-checked'
                          : 'bg-input border-border'
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                          backupSettingsForm.enabled ? 'translate-x-6' : 'translate-x-1'
                        )}
                      />
                    </button>
                  </div>
                </div>

                {/* Backup Information */}
                <div className="space-y-4">
                  <h3 className="font-medium">Backup Details</h3>

                  <div className="p-4 bg-muted/10 rounded-lg border border-border space-y-3">
                    <div className="flex items-start gap-3">
                      <Archive className="w-5 h-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">Backup Location</p>
                        <p className="text-xs text-muted-foreground">
                          Backups are stored in a <code className="bg-muted px-1 rounded">DocHub_Backups</code> folder
                          in the same directory as the original document.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <Archive className="w-5 h-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">Naming Convention</p>
                        <p className="text-xs text-muted-foreground">
                          Backup files are named using incremental numbering:
                        </p>
                        <code className="text-xs bg-muted px-2 py-1 rounded block mt-1">
                          filename_Backup_1.docx, filename_Backup_2.docx, ...
                        </code>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Info Card */}
                <div className="pt-4 border-t border-border">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Archive className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">About Backups</h4>
                      <p className="text-sm text-muted-foreground">
                        Automatic backups protect your documents by creating a copy before any processing
                        changes are applied. Each backup is numbered incrementally, allowing you to restore
                        from any previous version if needed. Disable this feature only if you have your own
                        backup solution in place.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveBackupSettings}
                    showSuccess={saveSuccess}
                    icon={<Save className="w-4 h-4" />}
                  >
                    Save Settings
                  </Button>
                </div>
              </div>
            </div>
          )}
        </motion.main>
      </div>

      <ColorPickerDialog
        isOpen={activeColorPicker !== null}
        onClose={() => setActiveColorPicker(null)}
        color={tempColor}
        onColorChange={(color) => {
          switch (activeColorPicker) {
            case 'accent':
              setCustomAccentColor(color);
              setAccentColor('custom');
              break;
            case 'primary':
              setCustomPrimaryColor(color);
              break;
            case 'background':
              setCustomBackgroundColor(color);
              break;
            case 'header':
              setCustomHeaderColor(color);
              break;
            case 'sidebar':
              setCustomSidebarColor(color);
              break;
            case 'border':
              setCustomBorderColor(color);
              break;
          }
          setActiveColorPicker(null);
        }}
        title={
          activeColorPicker === 'accent'
            ? 'Custom Accent Color'
            : activeColorPicker === 'primary'
              ? 'Custom Primary Color'
              : activeColorPicker === 'background'
                ? 'Custom Background Color'
                : activeColorPicker === 'header'
                  ? 'Custom Header Color'
                  : activeColorPicker === 'sidebar'
                    ? 'Custom Sidebar Color'
                    : activeColorPicker === 'border'
                      ? 'Custom Border Color'
                      : 'Pick a Color'
        }
      />

      {/* Reset Stats Confirmation Dialog */}
      <ConfirmDialog
        open={showResetStatsDialog}
        onOpenChange={setShowResetStatsDialog}
        onConfirm={handleResetStats}
        title="Reset All Statistics?"
        message="This will permanently delete all historical data including daily, weekly, and monthly statistics. Your all-time totals will be reset to zero. This action cannot be undone."
        confirmText="Reset All Stats"
        variant="destructive"
        loading={isResettingStats}
      />
    </motion.div>
  );
}
