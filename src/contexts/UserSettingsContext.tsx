import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { UserSettings, defaultUserSettings } from '@/types/settings';

interface UserSettingsContextType {
  settings: UserSettings;
  updateSettings: (updates: Partial<UserSettings>) => void;
  updateProfile: (updates: Partial<UserSettings['profile']>) => void;
  updateNotifications: (updates: Partial<UserSettings['notifications']>) => void;
  updateApiConnections: (updates: Partial<UserSettings['apiConnections']>) => void;
  saveSettings: () => Promise<boolean>;
  loadSettings: () => void;
  resetSettings: () => void;
}

const UserSettingsContext = createContext<UserSettingsContextType | undefined>(undefined);

const STORAGE_KEY = 'userSettings';

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(defaultUserSettings);

  const loadSettings = () => {
    try {
      const storedSettings = localStorage.getItem(STORAGE_KEY);
      if (storedSettings) {
        const parsed = JSON.parse(storedSettings);
        setSettings({ ...defaultUserSettings, ...parsed });
      }
    } catch (error) {
      console.error('Failed to load user settings:', error);
      setSettings(defaultUserSettings);
    }
  };

  const saveSettings = async (): Promise<boolean> => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      return true;
    } catch (error) {
      console.error('Failed to save user settings:', error);
      return false;
    }
  };

  const updateSettings = (updates: Partial<UserSettings>) => {
    setSettings((prev) => {
      const newSettings = { ...prev, ...updates };
      // Auto-save to localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
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