export interface DailyStats {
  date: string; // ISO date string (YYYY-MM-DD)
  documentsProcessed: number;
  hyperlinksChecked: number;
  feedbackImported: number;
  timeSaved: number; // in minutes
}

export interface WeeklyStats {
  weekStart: string; // ISO date string for Monday of the week
  weekEnd: string; // ISO date string for Sunday of the week
  documentsProcessed: number;
  hyperlinksChecked: number;
  feedbackImported: number;
  timeSaved: number;
  dailyBreakdown: DailyStats[];
}

export interface MonthlyStats {
  month: string; // Format: YYYY-MM
  documentsProcessed: number;
  hyperlinksChecked: number;
  feedbackImported: number;
  timeSaved: number;
  weeklyBreakdown: WeeklyStats[];
}

export interface GlobalStats {
  // Overall totals (never reset unless explicitly requested)
  allTime: {
    documentsProcessed: number;
    hyperlinksChecked: number;
    feedbackImported: number;
    timeSaved: number;
    firstActivityDate?: string; // ISO date string
    lastActivityDate?: string; // ISO date string
  };

  // Current period stats
  today: DailyStats;
  currentWeek: WeeklyStats;
  currentMonth: MonthlyStats;

  // Historical data (last 30 days)
  dailyHistory: DailyStats[];

  // Historical data (last 12 weeks)
  weeklyHistory: WeeklyStats[];

  // Historical data (last 12 months)
  monthlyHistory: MonthlyStats[];

  // Metadata
  lastUpdated: string; // ISO timestamp
  version: number; // Schema version for future migrations
}

export interface StatsUpdate {
  documentsProcessed?: number;
  hyperlinksChecked?: number;
  feedbackImported?: number;
  timeSaved?: number;
}

export interface GlobalStatsContextType {
  stats: GlobalStats;

  // Update methods
  updateStats: (update: StatsUpdate) => Promise<void>;

  // Retrieval methods
  getTodayStats: () => DailyStats;
  getWeekStats: () => WeeklyStats;
  getMonthStats: () => MonthlyStats;
  getDailyHistory: (days?: number) => DailyStats[];
  getWeeklyHistory: (weeks?: number) => WeeklyStats[];
  getMonthlyHistory: (months?: number) => MonthlyStats[];

  // Comparison methods
  getTodayChange: () => StatsUpdate; // Change from yesterday
  getWeekChange: () => StatsUpdate; // Change from last week
  getMonthChange: () => StatsUpdate; // Change from last month

  // Reset method
  resetAllStats: () => Promise<void>;

  // Loading state
  isLoading: boolean;
}

export const createEmptyDailyStats = (date: string): DailyStats => ({
  date,
  documentsProcessed: 0,
  hyperlinksChecked: 0,
  feedbackImported: 0,
  timeSaved: 0,
});

export const createEmptyWeeklyStats = (weekStart: string, weekEnd: string): WeeklyStats => ({
  weekStart,
  weekEnd,
  documentsProcessed: 0,
  hyperlinksChecked: 0,
  feedbackImported: 0,
  timeSaved: 0,
  dailyBreakdown: [],
});

export const createEmptyMonthlyStats = (month: string): MonthlyStats => ({
  month,
  documentsProcessed: 0,
  hyperlinksChecked: 0,
  feedbackImported: 0,
  timeSaved: 0,
  weeklyBreakdown: [],
});

export const createDefaultGlobalStats = (): GlobalStats => {
  const today = new Date().toISOString().split('T')[0];
  const monday = getMonday(new Date()).toISOString().split('T')[0];
  const sunday = getSunday(new Date()).toISOString().split('T')[0];
  const month = today.substring(0, 7); // YYYY-MM

  return {
    allTime: {
      documentsProcessed: 0,
      hyperlinksChecked: 0,
      feedbackImported: 0,
      timeSaved: 0,
    },
    today: createEmptyDailyStats(today),
    currentWeek: createEmptyWeeklyStats(monday, sunday),
    currentMonth: createEmptyMonthlyStats(month),
    dailyHistory: [],
    weeklyHistory: [],
    monthlyHistory: [],
    lastUpdated: new Date().toISOString(),
    version: 1,
  };
};

// Helper functions
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
  return new Date(d.setDate(diff));
}

function getSunday(date: Date): Date {
  const monday = getMonday(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}
