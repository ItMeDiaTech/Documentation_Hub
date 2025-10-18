import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { UserSettings, defaultUserSettings } from '@/types/settings';
import { logger } from '@/utils/logger';
import { safeJsonParse, safeJsonStringify } from '@/utils/safeJsonParse';

interface UserSettingsContextType {
  settings: UserSettings;
  updateSettings: (updates: Partial<UserSettings>) => void;
  updateProfile: (updates: Partial<UserSettings['profile']>) => void;
  updateNotifications: (updates: Partial<UserSettings['notifications']>) => void;
  updateApiConnections: (updates: Partial<UserSettings['apiConnections']>) => void;
  updateUpdateSettings: (updates: Partial<UserSettings['updateSettings']>) => void;
  saveSettings: () => Promise<boolean>;
  loadSettings: () => void;
  resetSettings: () => void;
}

const UserSettingsContext = createContext<UserSettingsContextType | undefined>(undefined);

const STORAGE_KEY = 'userSettings';

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const log = logger.namespace('UserSettings');
  const [settings, setSettings] = useState<UserSettings>(defaultUserSettings);

  const loadSettings = () => {
    const storedSettings = localStorage.getItem(STORAGE_KEY);
    const parsed = safeJsonParse<Partial<UserSettings>>(
      storedSettings,
      {},
      'UserSettings.loadSettings'
    );
    setSettings({ ...defaultUserSettings, ...parsed });
  };

  const saveSettings = async (): Promise<boolean> => {
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
  };

  const updateSettings = (updates: Partial<UserSettings>) => {
    setSettings((prev) => {
      const newSettings = { ...prev, ...updates };
      // Auto-save to localStorage
      const jsonString = safeJsonStringify(newSettings, undefined, 'UserSettings.updateSettings');
      if (jsonString) {
        try {
          localStorage.setItem(STORAGE_KEY, jsonString);
        } catch (error) {
          log.error('Failed to auto-save settings:', error);
        }
      }
      return newSettings;
    });
  };

  const updateProfile = (updates: Partial<UserSettings['profile']>) => {
    setSettings((prev) => ({
      ...prev,
      profile: { ...prev.profile, ...updates },
    }));
  };

  const updateNotifications = (updates: Partial<UserSettings['notifications']>) => {
    setSettings((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, ...updates },
    }));
  };

  const updateApiConnections = (updates: Partial<UserSettings['apiConnections']>) => {
    setSettings((prev) => {
      const newSettings = {
        ...prev,
        apiConnections: { ...prev.apiConnections, ...updates },
      };
      // Auto-save API settings to localStorage
      const jsonString = safeJsonStringify(newSettings, undefined, 'UserSettings.updateApiConnections');
      if (jsonString) {
        try {
          localStorage.setItem(STORAGE_KEY, jsonString);
        } catch (error) {
          log.error('Failed to auto-save API connections:', error);
        }
      }
      return newSettings;
    });
  };

  const updateUpdateSettings = (updates: Partial<UserSettings['updateSettings']>) => {
    setSettings((prev) => {
      const newSettings = {
        ...prev,
        updateSettings: { ...prev.updateSettings, ...updates },
      };
      // Auto-save update settings to localStorage
      const jsonString = safeJsonStringify(newSettings, undefined, 'UserSettings.updateUpdateSettings');
      if (jsonString) {
        try {
          localStorage.setItem(STORAGE_KEY, jsonString);
        } catch (error) {
          log.error('Failed to auto-save update settings:', error);
        }
      }
      return newSettings;
    });
  };

  const resetSettings = () => {
    setSettings(defaultUserSettings);
    localStorage.removeItem(STORAGE_KEY);
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const value: UserSettingsContextType = {
    settings,
    updateSettings,
    updateProfile,
    updateNotifications,
    updateApiConnections,
    updateUpdateSettings,
    saveSettings,
    loadSettings,
    resetSettings,
  };

  return (
    <UserSettingsContext.Provider value={value}>
      {children}
    </UserSettingsContext.Provider>
  );
}

export function useUserSettings() {
  const context = useContext(UserSettingsContext);
  if (!context) {
    throw new Error('useUserSettings must be used within a UserSettingsProvider');
  }
  return context;
}