export interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
}

export interface NotificationSettings {
  emailNotifications: boolean;
  pushNotifications: boolean;
  projectUpdates: boolean;
  teamMentions: boolean;
  weeklyDigest: boolean;
}

export interface ApiConnections {
  powerAutomateUrl: string;
  bugReportUrl: string;
  submitIdeaUrl: string;
}

export interface UpdateSettings {
  autoUpdateOnLaunch: boolean;
  checkForPreReleases: boolean;
}

/**
 * Local Dictionary Settings for SharePoint Dictionary integration
 * When enabled, hyperlink lookups use local SQLite database instead of API
 */
export interface LocalDictionarySettings {
  enabled: boolean;
  sharePointSiteUrl: string;
  documentLibraryPath: string;
  tenantId: string;
  clientId: string;
  syncIntervalHours: number;
  lastSyncTime: string | null;
  lastSyncSuccess: boolean;
}

/**
 * Backup Settings for document backup configuration
 */
export interface BackupSettings {
  enabled: boolean;
}

export interface UserSettings {
  profile: UserProfile;
  notifications: NotificationSettings;
  apiConnections: ApiConnections;
  language: string;
  timezone: string;
  dateFormat: string;
  updateSettings: UpdateSettings;
  localDictionary: LocalDictionarySettings;
  backupSettings: BackupSettings;
}

export const defaultUserSettings: UserSettings = {
  profile: {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
  },
  notifications: {
    emailNotifications: false,
    pushNotifications: false,
    projectUpdates: false,
    teamMentions: false,
    weeklyDigest: false,
  },
  apiConnections: {
    powerAutomateUrl: 'https://www.example.com',
    bugReportUrl: 'https://www.example.com',
    submitIdeaUrl: 'https://www.example.com',
  },
  language: 'English (US)',
  timezone: 'UTC-05:00 Eastern Time (ET)',
  dateFormat: 'MM/DD/YYYY',
  updateSettings: {
    autoUpdateOnLaunch: true,
    checkForPreReleases: false,
  },
  localDictionary: {
    enabled: false,
    sharePointSiteUrl: '',
    documentLibraryPath: '',
    tenantId: '',
    clientId: '',
    syncIntervalHours: 6,
    lastSyncTime: null,
    lastSyncSuccess: false,
  },
  backupSettings: {
    enabled: true,
  },
};
