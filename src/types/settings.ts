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
  // Show the "What's New" popup on first launch after the app updates
  showWhatsNewAfterUpdate: boolean;
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
  sharePointFileUrl: string; // Direct URL to .xlsx file on SharePoint
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

/**
 * A named hyperlink the user pins for quick access from the sidebar.
 * Used by both the Feedback and Document Managers features.
 * `id` is a stable per-row identity used as the React key, so reordering
 * rows does not re-key controlled inputs.
 */
export interface QuickLink {
  id: string;
  name: string;
  url: string;
}

/**
 * Development Environment settings (Settings → Development).
 *
 * The whole feature is gated behind `enabled` (default false). It is a
 * developer-only toolbox — an HTTP request workbench for the Nuxeo document
 * store, a command runner, and an MCP-tunnel config form. Every field here is
 * persisted so the developer's inputs survive a restart. Secrets (`authSecret`,
 * `mcpTunnel.authToken`) are entered through masked inputs; clearing the field
 * clears the stored value.
 */
export type DevAuthType = "none" | "basic" | "token" | "bearer";
export type DevHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** One editable header or query-param row. `id` is a stable React key. */
export interface DevKeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface DevHttpSettings {
  /** Shared base URL, e.g. `https://host/nuxeo`. Reused across requests. */
  baseUrl: string;
  /** The request target: relative to `baseUrl`, or an absolute http(s) URL. */
  path: string;
  method: DevHttpMethod;
  authType: DevAuthType;
  /** Username for Basic auth. */
  authUsername: string;
  /** Password / token / bearer value — masked in the UI. */
  authSecret: string;
  params: DevKeyValue[];
  headers: DevKeyValue[];
  /** Raw request body (JSON or text) for non-GET requests. */
  body: string;
  timeoutMs: number;
}

export interface DevTerminalSettings {
  cwd: string;
  lastCommand: string;
}

export interface DevMcpTunnelSettings {
  name: string;
  url: string;
  transport: string;
  /** Auth token — masked in the UI. */
  authToken: string;
  notes: string;
}

export interface DevEnvSettings {
  enabled: boolean;
  http: DevHttpSettings;
  terminal: DevTerminalSettings;
  mcpTunnel: DevMcpTunnelSettings;
}

/**
 * A partial update to `devEnv`. Nested sub-objects are merged leaf-wise against
 * the previous state, so callers pass only the fields they changed (race-safe —
 * concurrent updates to sibling fields don't clobber each other).
 */
export interface DevEnvPatch {
  enabled?: boolean;
  http?: Partial<DevHttpSettings>;
  terminal?: Partial<DevTerminalSettings>;
  mcpTunnel?: Partial<DevMcpTunnelSettings>;
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
  feedbackLinks: QuickLink[];
  documentManagerLinks: QuickLink[];
  devEnv: DevEnvSettings;
}

export const defaultUserSettings: UserSettings = {
  profile: {
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@example.com",
  },
  notifications: {
    emailNotifications: false,
    pushNotifications: false,
    projectUpdates: false,
    teamMentions: false,
    weeklyDigest: false,
  },
  apiConnections: {
    powerAutomateUrl: "https://www.example.com",
    bugReportUrl: "https://www.example.com",
    submitIdeaUrl: "https://www.example.com",
  },
  language: "English (US)",
  timezone: "UTC-05:00 Eastern Time (ET)",
  dateFormat: "MM/DD/YYYY",
  updateSettings: {
    autoUpdateOnLaunch: true,
    checkForPreReleases: false,
    showWhatsNewAfterUpdate: true,
    useSharePointSource: false,
    sharePointFolderUrl: "",
  },
  localDictionary: {
    enabled: false,
    sharePointFileUrl: "",
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
  feedbackLinks: [],
  documentManagerLinks: [],
  devEnv: {
    enabled: false,
    http: {
      baseUrl: "",
      path: "",
      method: "GET",
      authType: "none",
      authUsername: "",
      authSecret: "",
      params: [],
      headers: [],
      body: "",
      timeoutMs: 45000,
    },
    terminal: {
      cwd: "",
      lastCommand: "",
    },
    mcpTunnel: {
      name: "",
      url: "",
      transport: "sse",
      authToken: "",
      notes: "",
    },
  },
};
