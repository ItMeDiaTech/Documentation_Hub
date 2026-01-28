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
  // SharePoint update source (alternative to GitHub)
  useSharePointSource: boolean;
  sharePointFolderUrl: string;
}

/**
 * Local Dictionary Settings for SharePoint Dictionary integration
 * When enabled, hyperlink lookups use local SQLite database instead of API
 *
 * Uses interactive browser authentication (like the Updates feature)
 * to download and parse an Excel file containing Document_ID, Content_ID, Title, Status
 */
export interface LocalDictionarySettings {
  enabled: boolean;
  sharePointFileUrl: string;      // Direct URL to .xlsx file on SharePoint
  lastRetrievalTime: string | null;
  lastRetrievalSuccess: boolean;
  totalEntries: number;
}

/**
 * Backup Settings for document backup configuration
 */
export interface BackupSettings {
  enabled: boolean;
}

/**
 * Display Settings for monitor configuration
 * Used for document comparison feature
 */
export interface DisplaySettings {
  comparisonMonitorId: number; // Index of selected monitor (0 = primary)
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
  displaySettings: DisplaySettings;
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
    useSharePointSource: false,
    sharePointFolderUrl: '',
  },
  localDictionary: {
    enabled: false,
    sharePointFileUrl: '',
    lastRetrievalTime: null,
    lastRetrievalSuccess: false,
    totalEntries: 0,
  },
  backupSettings: {
    enabled: true,
  },
  displaySettings: {
    comparisonMonitorId: 0, // Default to primary monitor
  },
};
