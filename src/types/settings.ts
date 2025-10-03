export interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  bio: string;
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
}

export interface UserSettings {
  profile: UserProfile;
  notifications: NotificationSettings;
  apiConnections: ApiConnections;
  language: string;
  timezone: string;
  dateFormat: string;
}

export const defaultUserSettings: UserSettings = {
  profile: {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    username: 'johndoe',
    bio: 'Software developer passionate about creating amazing experiences',
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
  },
  language: 'English (US)',
  timezone: 'UTC-05:00 Eastern Time (ET)',
  dateFormat: 'MM/DD/YYYY',
};