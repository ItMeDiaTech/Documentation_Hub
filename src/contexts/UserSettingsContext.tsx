import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import { UserSettings, defaultUserSettings } from '@/types/settings';
import { logger } from '@/utils/logger';
import { safeJsonParse, safeJsonStringify } from '@/utils/safeJsonParse';

interface UserSettingsContextType {
  settings: UserSettings;
  isLoading: boolean;
  updateSettings: (updates: Partial<UserSettings>) => void;
  updateProfile: (updates: Partial<UserSettings['profile']>) => void;
  updateNotifications: (updates: Partial<UserSettings['notifications']>) => void;
  updateApiConnections: (updates: Partial<UserSettings['apiConnections']>) => void;
  updateUpdateSettings: (updates: Partial<UserSettings['updateSettings']>) => void;
  updateLocalDictionary: (updates: Partial<UserSettings['localDictionary']>) => void;
  updateBackupSettings: (updates: Partial<UserSettings['backupSettings']>) => void;
  saveSettings: () => Promise<boolean>;
  loadSettings: () => void;
  resetSettings: () => void;
}

const UserSettingsContext = createContext<UserSettingsContextType | undefined>(undefined);

const STORAGE_KEY = 'userSettings';

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const log = logger.namespace('UserSettings');
  const [settings, setSettings] = useState<UserSettings>(defaultUserSettings);
  const [isLoading, setIsLoading] = useState(true);

  const loadSettings = useCallback(() => {
    setIsLoading(true);
    try {
      const storedSettings = localStorage.getItem(STORAGE_KEY);
      const parsed = safeJsonParse<Partial<UserSettings>>(
        storedSettings,
        {},
        'UserSettings.loadSettings'
      );
      setSettings({ ...defaultUserSettings, ...parsed });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveSettings = useCallback(async (): Promise<boolean> => {
    const jsonString = safeJsonStringify(settings, undefined, 'UserSettings.saveSettings');
    if (jsonString) {
      try {
        localStorage.setItem(STORAGE_KEY, jsonString);
        return true;
      } catch (error) {
        log.error('Failed to save user settings to localStorage:', error);
        return false;
      }
    }
    return false;
  }, [settings, log]);

  const updateSettings = useCallback((updates: Partial<UserSettings>) => {
    setSettings((prev) => {
      const newSettings = { ...prev, ...updates };
      // Auto-save to localStorage
      const jsonString = safeJsonStringify(newSettings, undefined, 'UserSettings.updateSettings');
      if (jsonString) {
        try {
          localStorage.setItem(STORAGE_KEY, jsonString);
        } catch (error) {
          // Silent fail - logged elsewhere
        }
      }
      return newSettings;
    });
  }, []);

  const updateProfile = useCallback((updates: Partial<UserSettings['profile']>) => {
    setSettings((prev) => {
      const newSettings = {
        ...prev,
        profile: { ...prev.profile, ...updates },
      };
      // Auto-save profile settings to localStorage
      const jsonString = safeJsonStringify(
        newSettings,
        undefined,
        'UserSettings.updateProfile'
      );
      if (jsonString) {
        try {
          localStorage.setItem(STORAGE_KEY, jsonString);
        } catch (error) {
          // Silent fail - logged elsewhere
        }
      }
      return newSettings;
    });
  }, []);

  const updateNotifications = useCallback((updates: Partial<UserSettings['notifications']>) => {
    setSettings((prev) => {
      const newSettings = {
        ...prev,
        notifications: { ...prev.notifications, ...updates },
      };
      // Auto-save notification settings to localStorage
      const jsonString = safeJsonStringify(
        newSettings,
        undefined,
        'UserSettings.updateNotifications'
      );
      if (jsonString) {
        try {
          localStorage.setItem(STORAGE_KEY, jsonString);
        } catch (error) {
          // Silent fail - logged elsewhere
        }
      }
      return newSettings;
    });
  }, []);

  const updateApiConnections = useCallback((updates: Partial<UserSettings['apiConnections']>) => {
    setSettings((prev) => {
      const newSettings = {
        ...prev,
        apiConnections: { ...prev.apiConnections, ...updates },
      };
      // Auto-save API settings to localStorage
      const jsonString = safeJsonStringify(
        newSettings,
        undefined,
        'UserSettings.updateApiConnections'
      );
      if (jsonString) {
        try {
          localStorage.setItem(STORAGE_KEY, jsonString);
        } catch (error) {
          // Silent fail - logged elsewhere
        }
      }
      return newSettings;
    });
  }, []);

  const updateUpdateSettings = useCallback((updates: Partial<UserSettings['updateSettings']>) => {
    setSettings((prev) => {
      const newSettings = {
        ...prev,
        updateSettings: { ...prev.updateSettings, ...updates },
      };
      // Auto-save update settings to localStorage
      const jsonString = safeJsonStringify(
        newSettings,
        undefined,
        'UserSettings.updateUpdateSettings'
      );
      if (jsonString) {
        try {
          localStorage.setItem(STORAGE_KEY, jsonString);
        } catch (error) {
          // Silent fail - logged elsewhere
        }
      }
      return newSettings;
    });
  }, []);

  const updateLocalDictionary = useCallback((updates: Partial<UserSettings['localDictionary']>) => {
    setSettings((prev) => {
      const newSettings = {
        ...prev,
        localDictionary: { ...prev.localDictionary, ...updates },
      };
      // Auto-save local dictionary settings to localStorage
      const jsonString = safeJsonStringify(
        newSettings,
        undefined,
        'UserSettings.updateLocalDictionary'
      );
      if (jsonString) {
        try {
          localStorage.setItem(STORAGE_KEY, jsonString);
        } catch (error) {
          // Silent fail - logged elsewhere
        }
      }
      return newSettings;
    });
  }, []);

  const updateBackupSettings = useCallback((updates: Partial<UserSettings['backupSettings']>) => {
    setSettings((prev) => {
      const newSettings = {
        ...prev,
        backupSettings: { ...prev.backupSettings, ...updates },
      };
      // Auto-save backup settings to localStorage
      const jsonString = safeJsonStringify(
        newSettings,
        undefined,
        'UserSettings.updateBackupSettings'
      );
      if (jsonString) {
        try {
          localStorage.setItem(STORAGE_KEY, jsonString);
        } catch (error) {
          // Silent fail - logged elsewhere
        }
      }
      return newSettings;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(defaultUserSettings);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // PERFORMANCE FIX: Memoize context value to prevent unnecessary re-renders in consumers
  // Without this, every render creates a new object reference, causing all consumers to re-render
  const value = useMemo<UserSettingsContextType>(
    () => ({
      settings,
      isLoading,
      updateSettings,
      updateProfile,
      updateNotifications,
      updateApiConnections,
      updateUpdateSettings,
      updateLocalDictionary,
      updateBackupSettings,
      saveSettings,
      loadSettings,
      resetSettings,
    }),
    [
      settings,
      isLoading,
      updateSettings,
      updateProfile,
      updateNotifications,
      updateApiConnections,
      updateUpdateSettings,
      updateLocalDictionary,
      updateBackupSettings,
      saveSettings,
      loadSettings,
      resetSettings,
    ]
  );

  return <UserSettingsContext.Provider value={value}>{children}</UserSettingsContext.Provider>;
}

export function useUserSettings() {
  const context = useContext(UserSettingsContext);
  if (!context) {
    throw new Error('useUserSettings must be used within a UserSettingsProvider');
  }
  return context;
}
