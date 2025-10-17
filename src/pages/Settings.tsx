import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { ColorPickerDialog } from '@/components/common/ColorPickerDialog';
import {
  User,
  Palette,
  Globe,
  Database,
  Sun,
  Moon,
  Check,
  Type,
  Search,
  Lightbulb,
  Send,
  Link2,
  Save,
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useUserSettings } from '@/contexts/UserSettingsContext';
import { useSession } from '@/contexts/SessionContext';
import { useGlobalStats } from '@/contexts/GlobalStatsContext';
import { cn } from '@/utils/cn';
import { getContrastTextColor } from '@/utils/colorConvert';
import { sanitizeUrl, validatePowerAutomateUrl, hasEncodingIssues } from '@/utils/urlHelpers';
import logger from '@/utils/logger';

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
    ],
  },
  {
    group: 'System',
    items: [
      { id: 'language', label: 'Language', icon: Globe, description: 'Region & locale' },
      { id: 'updates', label: 'Updates', icon: Download, description: 'App updates & versioning' },
      { id: 'api-connections', label: 'API Connections', icon: Link2, description: 'External services' },
      { id: 'data', label: 'Storage', icon: Database, description: 'Data management' },
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

  const { settings, updateProfile, updateNotifications, updateApiConnections, updateUpdateSettings, updateSettings, saveSettings } = useUserSettings();
  const { sessions } = useSession();
  const { stats } = useGlobalStats();

  // Local form states
  const [profileForm, setProfileForm] = useState(settings.profile);
  const [notificationsForm, setNotificationsForm] = useState(settings.notifications);
  const [apiConnectionsForm, setApiConnectionsForm] = useState(settings.apiConnections);
  const [languageForm, setLanguageForm] = useState(settings.language);
  const [timezoneForm, setTimezoneForm] = useState(settings.timezone);
  const [dateFormatForm, setDateFormatForm] = useState(settings.dateFormat);
  const [updateSettingsForm, setUpdateSettingsForm] = useState(settings.updateSettings);

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
      } catch (error) {
        logger.error('Failed to get version:', error);
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

    const unsubAvailable = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateAvailable(true);
      setUpdateVersion(info.version);
      setUpdateStatus(`Update available: ${info.version}`);
      setCheckingForUpdates(false);
    });

    const unsubProgress = window.electronAPI.onUpdateDownloadProgress((progress) => {
      setDownloadProgress(progress.percent);
      setUpdateStatus(`Downloading update: ${Math.round(progress.percent)}%`);
    });

    const unsubDownloaded = window.electronAPI.onUpdateDownloaded((info) => {
      setUpdateDownloaded(true);
      setDownloadProgress(100);
      setUpdateStatus(`Update ${info.version} downloaded. Ready to install.`);
    });

    const unsubNotAvailable = window.electronAPI.onUpdateNotAvailable(() => {
      setUpdateAvailable(false);
      setUpdateStatus('You are up to date');
      setCheckingForUpdates(false);
    });

    const unsubError = window.electronAPI.onUpdateError((error) => {
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
  }, [settings]);

  const handlePowerAutomateUrlChange = (url: string) => {
    // Update form
    setApiConnectionsForm({ ...apiConnectionsForm, powerAutomateUrl: url });

    // Auto-sanitize if encoding issues detected
    if (hasEncodingIssues(url)) {
      const sanitized = sanitizeUrl(url);
      setShowUrlWarning(true);
      setTimeout(() => {
        setApiConnectionsForm({ ...apiConnectionsForm, powerAutomateUrl: sanitized });
        setShowUrlWarning(false);
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

    // Save to localStorage
    const success = await saveSettings();
    if (success) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
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
    } catch (error) {
      setUpdateStatus('Error checking for updates');
      setCheckingForUpdates(false);
    }
  };

  const handleDownloadUpdate = async () => {
    setUpdateStatus('Starting download...');
    try {
      await window.electronAPI?.downloadUpdate();
      // Progress will be updated by event listeners
    } catch (error) {
      setUpdateStatus('Download failed');
    }
  };

  const handleInstallUpdate = () => {
    // This will quit the app and install the update
    window.electronAPI?.installUpdate();
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
        setTimeout(() => setSaveSuccess(false), 2000);
      } else {
        logger.error('Failed to save export data:', saveResult.error);
      }
    } catch (error) {
      logger.error('Export failed:', error);
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
      setTimeout(() => setSaveSuccess(false), 2000);

      // Reload page to apply all changes
      window.location.reload();
    } catch (error) {
      logger.error('Import failed:', error);
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
                  <Input label="First Name" defaultValue="John" />
                  <Input label="Last Name" defaultValue="Doe" />
                </div>
                <Input label="Email" type="email" defaultValue="john.doe@example.com" />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" icon={<Download className="w-4 h-4" />}>
                    Export Settings
                  </Button>
                  <Button variant="outline" icon={<Download className="w-4 h-4" style={{ transform: 'rotate(180deg)' }} />}>
                    Import Settings
                  </Button>
                  <Button>Save Changes</Button>
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

              {/* Theme & Density */}
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-4">Theme & Display</h3>
                  <div className="flex flex-col lg:flex-row gap-6">
                    <div className="flex-1">
                      <label className="text-sm text-foreground mb-3 block">Theme Mode</label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          {
                            value: 'light' as const,
                            label: 'Light',
                            icon: Sun,
                            gradient: 'from-amber-200 to-yellow-400',
                          },
                          {
                            value: 'dark' as const,
                            label: 'Dark',
                            icon: Moon,
                            gradient: 'from-slate-800 to-slate-900',
                          },
                        ].map((option) => {
                          const Icon = option.icon;
                          return (
                            <motion.button
                              key={option.value}
                              onClick={() => setTheme(option.value)}
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              aria-label={`Select ${option.label} theme`}
                              className={cn(
                                'relative p-3 rounded-lg border-2 transition-all overflow-hidden group',
                                theme === option.value
                                  ? 'border-primary shadow-lg'
                                  : 'border-border hover:border-muted-foreground'
                              )}
                            >
                              <div
                                className={cn(
                                  'absolute inset-0 bg-gradient-to-br opacity-10 group-hover:opacity-20 transition-opacity',
                                  option.gradient
                                )}
                              />
                              <div className="relative">
                                <Icon className="w-5 h-5 mb-1 mx-auto" />
                                <p className="text-xs font-medium">{option.label}</p>
                              </div>
                              {theme === option.value && (
                                <motion.div
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  className="absolute top-1 right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center"
                                >
                                  <Check className="w-2.5 h-2.5 text-primary-foreground" />
                                </motion.div>
                              )}
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex-1">
                      <label className="text-sm text-foreground mb-3 block">
                        Interface Density
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { value: 'comfortable' as const, label: 'Comfortable' },
                          { value: 'compact' as const, label: 'Compact' },
                          { value: 'minimal' as const, label: 'Minimal' },
                        ].map((option) => (
                          <motion.button
                            key={option.value}
                            onClick={() => setDensity(option.value)}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            aria-label={`Select ${option.label} density`}
                            className={cn(
                              'relative p-3 rounded-lg border-2 transition-all overflow-hidden',
                              density === option.value
                                ? 'border-primary shadow-lg bg-primary/10'
                                : 'border-border hover:border-muted-foreground hover:bg-muted'
                            )}
                          >
                            <p className="text-xs font-medium">{option.label}</p>
                            {density === option.value && (
                              <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="absolute top-1 right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center"
                              >
                                <Check className="w-2.5 h-2.5 text-primary-foreground" />
                              </motion.div>
                            )}
                          </motion.button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-medium mb-4">Accent Color</h3>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      {
                        name: 'blue' as const,
                        color: 'bg-blue-500',
                        gradient: 'from-blue-400 to-blue-600',
                      },
                      {
                        name: 'purple' as const,
                        color: 'bg-purple-500',
                        gradient: 'from-purple-400 to-purple-600',
                      },
                      {
                        name: 'green' as const,
                        color: 'bg-green-500',
                        gradient: 'from-green-400 to-green-600',
                      },
                      {
                        name: 'orange' as const,
                        color: 'bg-orange-500',
                        gradient: 'from-orange-400 to-orange-600',
                      },
                      {
                        name: 'pink' as const,
                        color: 'bg-pink-500',
                        gradient: 'from-pink-400 to-pink-600',
                      },
                      {
                        name: 'cyan' as const,
                        color: 'bg-cyan-500',
                        gradient: 'from-cyan-400 to-cyan-600',
                      },
                      {
                        name: 'indigo' as const,
                        color: 'bg-indigo-500',
                        gradient: 'from-indigo-400 to-indigo-600',
                      },
                      {
                        name: 'custom' as const,
                        color: '',
                        gradient:
                          'from-red-400 via-yellow-400 via-green-400 via-blue-400 via-indigo-400 via-purple-400 to-pink-400',
                      },
                    ].map((color) => (
                      <motion.button
                        key={color.name}
                        onClick={() => {
                          if (color.name === 'custom') {
                            setAccentColor('custom');
                            setTempColor(customAccentColor);
                            setActiveColorPicker('accent');
                          } else {
                            setAccentColor(color.name);
                          }
                        }}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        className={cn(
                          'relative w-12 h-12 rounded-xl overflow-hidden transition-all',
                          'ring-2 ring-offset-2 ring-offset-background',
                          accentColor === color.name
                            ? 'ring-primary shadow-lg'
                            : 'ring-transparent hover:ring-muted-foreground/50'
                        )}
                        aria-label={`${color.name} accent`}
                      >
                        {color.name === 'custom' ? (
                          <>
                            {/* Inline style required for dynamic custom or conic gradient background */}
                            <div
                              className="absolute inset-0"
                              style={{
                                background:
                                  accentColor === 'custom'
                                    ? customAccentColor
                                    : `conic-gradient(from 180deg at 50% 50%, #ef4444, #f59e0b, #eab308, #84cc16, #22c55e, #14b8a6, #06b6d4, #3b82f6, #6366f1, #8b5cf6, #a855f7, #d946ef, #ec4899, #ef4444)`,
                              }}
                            />
                          </>
                        ) : (
                          <div
                            className={cn('absolute inset-0 bg-gradient-to-br', color.gradient)}
                          />
                        )}
                        {accentColor === color.name && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="absolute inset-0 flex items-center justify-center pointer-events-none"
                          >
                            <Check className="w-4 h-4 text-white drop-shadow-md" />
                          </motion.div>
                        )}
                      </motion.button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-medium mb-4">Visual Effects</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <span className="text-sm font-medium">Glass morphism effects</span>
                        <p className="text-xs text-muted-foreground">
                          Blur and transparency effects
                        </p>
                      </div>
                      <button
                        onClick={() => setBlur(!blur)}
                        aria-label="Toggle glass morphism effects"
                        className={cn(
                          'relative w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2',
                          blur ? 'bg-primary border-primary toggle-checked' : 'bg-input border-border hover:bg-accent'
                        )}
                      >
                        <motion.span
                          className="absolute top-0.5 w-5 h-5 bg-background rounded-full shadow-xs"
                          animate={{ left: blur ? '1.25rem' : '0.125rem' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <span className="text-sm font-medium">Smooth animations</span>
                        <p className="text-xs text-muted-foreground">
                          Transitions and micro-interactions
                        </p>
                      </div>
                      <button
                        onClick={() => setAnimations(!animations)}
                        aria-label="Toggle smooth animations"
                        className={cn(
                          'relative w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2',
                          animations ? 'bg-primary border-primary toggle-checked' : 'bg-input border-border hover:bg-accent'
                        )}
                      >
                        <motion.span
                          className="absolute top-0.5 w-5 h-5 bg-background rounded-full shadow-xs"
                          animate={{ left: animations ? '1.25rem' : '0.125rem' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>

                    <div className="pt-2 text-xs text-muted-foreground">
                      <p>
                        Note: Disabling visual effects can improve performance on slower systems.
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-4 mb-4">
                    <h3 className="font-medium flex-1">Custom Theme Colors</h3>
                    <button
                      onClick={() => setUseCustomColors(!useCustomColors)}
                      aria-label="Toggle custom theme colors"
                      className={cn(
                        'relative w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2',
                        useCustomColors ? 'bg-primary border-primary toggle-checked' : 'bg-input border-border hover:bg-accent'
                      )}
                    >
                      <motion.span
                        className="absolute top-0.5 w-5 h-5 bg-background rounded-full shadow-xs"
                        animate={{ left: useCustomColors ? '1.25rem' : '0.125rem' }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    </button>
                  </div>

                  {useCustomColors && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-foreground mb-1 block">Primary</label>
                        <button
                          aria-label="Select primary color"
                          onClick={() => {
                            setTempColor(customPrimaryColor);
                            setActiveColorPicker('primary');
                          }}
                          className="w-full h-10 rounded-md border border-border flex items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                        >
                          {/* eslint-disable-next-line */}
                          <div
                            className="w-6 h-6 rounded"
                            style={{
                              backgroundColor: customPrimaryColor,
                              border: `2px solid ${getContrastTextColor(customPrimaryColor)}`
                            }}
                          />
                        </button>
                      </div>

                      <div>
                        <label className="text-xs text-foreground mb-1 block">
                          Background
                        </label>
                        <button
                          aria-label="Select background color"
                          onClick={() => {
                            setTempColor(customBackgroundColor);
                            setActiveColorPicker('background');
                          }}
                          className="w-full h-10 rounded-md border border-border flex items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                        >
                          {/* eslint-disable-next-line */}
                          <div
                            className="w-6 h-6 rounded"
                            style={{
                              backgroundColor: customBackgroundColor,
                              border: `2px solid ${getContrastTextColor(customBackgroundColor)}`
                            }}
                          />
                        </button>
                        {/* Visual indicator for calculated text color */}
                        <p className="text-xs text-muted-foreground mt-1">
                          Text: {getContrastTextColor(customBackgroundColor) === '#FFFFFF' ? '⚪ White' : '⚫ Black'} (auto)
                        </p>
                      </div>

                      <div>
                        <label className="text-xs text-foreground mb-1 block">Header</label>
                        <button
                          aria-label="Select header color"
                          onClick={() => {
                            setTempColor(customHeaderColor);
                            setActiveColorPicker('header');
                          }}
                          className="w-full h-10 rounded-md border border-border flex items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                        >
                          {/* eslint-disable-next-line */}
                          <div
                            className="w-6 h-6 rounded"
                            style={{
                              backgroundColor: customHeaderColor,
                              border: `2px solid ${getContrastTextColor(customHeaderColor)}`
                            }}
                          />
                        </button>
                        {/* Visual indicator for calculated text color */}
                        <p className="text-xs text-muted-foreground mt-1">
                          Text: {getContrastTextColor(customHeaderColor) === '#FFFFFF' ? '⚪ White' : '⚫ Black'} (auto)
                        </p>
                      </div>

                      <div>
                        <label className="text-xs text-foreground mb-1 block">Sidebar</label>
                        <button
                          aria-label="Select sidebar color"
                          onClick={() => {
                            setTempColor(customSidebarColor);
                            setActiveColorPicker('sidebar');
                          }}
                          className="w-full h-10 rounded-md border border-border flex items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                        >
                          {/* eslint-disable-next-line */}
                          <div
                            className="w-6 h-6 rounded"
                            style={{
                              backgroundColor: customSidebarColor,
                              border: `2px solid ${getContrastTextColor(customSidebarColor)}`
                            }}
                          />
                        </button>
                        {/* Visual indicator for calculated text color */}
                        <p className="text-xs text-muted-foreground mt-1">
                          Text: {getContrastTextColor(customSidebarColor) === '#FFFFFF' ? '⚪ White' : '⚫ Black'} (auto)
                        </p>
                      </div>

                      <div>
                        <label className="text-xs text-foreground mb-1 block">Borders</label>
                        <button
                          aria-label="Select border color"
                          onClick={() => {
                            setTempColor(customBorderColor);
                            setActiveColorPicker('border');
                          }}
                          className="w-full h-10 rounded-md border border-border flex items-center justify-center gap-2 hover:bg-muted/50 transition-colors"
                        >
                          {/* eslint-disable-next-line */}
                          <div
                            className="w-6 h-6 rounded"
                            style={{
                              backgroundColor: customBorderColor,
                              border: `2px solid ${getContrastTextColor(customBorderColor)}`
                            }}
                          />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
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
                  {/* eslint-disable-next-line */}
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
                  {/* eslint-disable-next-line */}
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
                  {/* eslint-disable-next-line */}
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
                    <label className="text-sm text-foreground mb-2 block">
                      Letter Spacing
                    </label>
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
                  <Button onClick={handleSaveSettings} showSuccess={saveSuccess} icon={<Save className="w-4 h-4" />}>
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
                      <p className="text-sm text-muted-foreground">{currentVersion || 'Loading...'}</p>
                    </div>
                    <Button
                      onClick={handleCheckForUpdates}
                      disabled={checkingForUpdates}
                      icon={<RefreshCw className={cn('w-4 h-4', checkingForUpdates && 'animate-spin')} />}
                    >
                      {checkingForUpdates ? 'Checking...' : 'Check for Updates'}
                    </Button>
                  </div>
                  {updateStatus && (
                    <p className="text-sm text-muted-foreground">{updateStatus}</p>
                  )}
                  {updateAvailable && !updateDownloaded && (
                    <Button
                      onClick={handleDownloadUpdate}
                      variant="default"
                      className="w-full"
                      disabled={downloadProgress > 0 && downloadProgress < 100}
                    >
                      {downloadProgress > 0 ? `Downloading ${Math.round(downloadProgress)}%` : `Download Update ${updateVersion}`}
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
                      onClick={() => setUpdateSettingsForm({ ...updateSettingsForm, autoUpdateOnLaunch: !updateSettingsForm.autoUpdateOnLaunch })}
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors border-2',
                        updateSettingsForm.autoUpdateOnLaunch ? 'bg-primary border-primary toggle-checked' : 'bg-input border-border'
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
                      onClick={() => setUpdateSettingsForm({ ...updateSettingsForm, checkForPreReleases: !updateSettingsForm.checkForPreReleases })}
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors border-2',
                        updateSettingsForm.checkForPreReleases ? 'bg-primary border-primary toggle-checked' : 'bg-input border-border'
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

                <div className="flex justify-end">
                  <Button onClick={handleSaveSettings} showSuccess={saveSuccess} icon={<Save className="w-4 h-4" />}>
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
                            setTimeout(() => {
                              const pasted = e.currentTarget.value;
                              if (hasEncodingIssues(pasted)) {
                                handlePowerAutomateUrlChange(pasted);
                              }
                            }, 10);
                          }}
                          placeholder="https://prod-11.westus.logic.azure.com/workflows/..."
                          className={cn(
                            "w-full px-3 py-2 pr-10 rounded-md border bg-background focus:outline-none focus:ring-1",
                            urlValidation?.valid === false
                              ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                              : urlValidation?.warnings.length
                              ? "border-yellow-500 focus:border-yellow-500 focus:ring-yellow-500/20"
                              : "border-input focus:border-primary focus:ring-primary/20"
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
                            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
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
                            <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 space-y-1">
                              {urlValidation.warnings.map((warning, idx) => (
                                <p key={idx} className="text-xs text-yellow-700 dark:text-yellow-300">
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
                            <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-blue-700 dark:text-blue-300">
                              URL automatically sanitized! Encoded characters have been fixed.
                            </p>
                          </div>
                        </div>
                      )}

                      <p className="text-xs text-muted-foreground mt-2">
                        This URL is used by the Hyperlink Service to retrieve document metadata and validate links.
                        The service will send collected document IDs to this endpoint and receive enriched data in response.
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
                        onChange={(e) => setApiConnectionsForm({ ...apiConnectionsForm, bugReportUrl: e.target.value })}
                        placeholder="https://www.example.com"
                        className="w-full px-3 py-2 rounded-md border border-input bg-background focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                      />
                      <p className="text-xs text-muted-foreground mt-2">
                        Bug reports will be sent to this API endpoint. Leave as default to use email instead.
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
                        onChange={(e) => setApiConnectionsForm({ ...apiConnectionsForm, submitIdeaUrl: e.target.value })}
                        placeholder="https://www.example.com"
                        className="w-full px-3 py-2 rounded-md border border-input bg-background focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                      />
                      <p className="text-xs text-muted-foreground mt-2">
                        Feature suggestions will be sent to this API endpoint. Leave as default to use email instead.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-border">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Link2 className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">About API Connections</h4>
                      <p className="text-sm text-muted-foreground">
                        API connections allow Documentation Hub to integrate with external services for enhanced functionality.
                        These endpoints are used during document processing to enrich data, validate content, and automate workflows.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSaveSettings} showSuccess={saveSuccess} icon={<Save className="w-4 h-4" />}>
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
                        title: ideaTitle,
                        benefit: ideaBenefit,
                        date: new Date().toISOString(),
                        version: currentVersion,
                      };

                      const apiUrl = settings.apiConnections.submitIdeaUrl;

                      // Check if using default URL - if so, fallback to mailto
                      if (apiUrl === 'https://www.example.com' || !apiUrl) {
                        const subject = encodeURIComponent(`Feature Idea: ${ideaTitle}`);
                        const body = encodeURIComponent(`
Feature Idea
------------
Title: ${ideaTitle}

Why is this needed / Who would this benefit?
${ideaBenefit}

Submitted: ${new Date().toLocaleString()}
Version: ${currentVersion}
                        `);

                        window.location.href = `mailto:support@example.com?subject=${subject}&body=${body}`;
                        setIdeaSubmitted(true);
                        setTimeout(() => {
                          setIdeaTitle('');
                          setIdeaBenefit('');
                          setIdeaSubmitted(false);
                        }, 2000);
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
                          setIdeaSubmitted(true);
                          setTimeout(() => {
                            setIdeaTitle('');
                            setIdeaBenefit('');
                            setIdeaSubmitted(false);
                          }, 2000);
                        } else {
                          alert('Failed to submit idea. Please try again.');
                        }
                      } catch (error) {
                        logger.error('Error submitting idea:', error);
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

          {activeSection === 'data' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Storage</h2>
                <p className="text-muted-foreground mt-1">
                  Manage your data storage and application cache
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium">Storage Used</p>
                      <p className="text-sm text-muted-foreground">2.4 GB of 10 GB</p>
                    </div>
                    <span className="text-2xl font-bold">24%</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className="w-1/4 h-full bg-primary" />
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-border">
                  <Button variant="outline" className="w-full">
                    Clear Cache
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    icon={<Download className="w-4 h-4" />}
                    onClick={handleExport}
                  >
                    Export Settings & Data
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    icon={<Download className="w-4 h-4" style={{ transform: 'rotate(180deg)' }} />}
                    onClick={handleImport}
                  >
                    Import Settings & Data
                  </Button>
                  <Button variant="destructive" className="w-full">
                    Delete Account
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
    </motion.div>
  );
}
