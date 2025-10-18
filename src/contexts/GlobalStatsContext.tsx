import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import {
  GlobalStats,
  GlobalStatsContextType,
  StatsUpdate,
  DailyStats,
  WeeklyStats,
  MonthlyStats,
  createDefaultGlobalStats,
  createEmptyDailyStats,
  createEmptyWeeklyStats,
  createEmptyMonthlyStats,
} from '@/types/globalStats';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { logger } from '@/utils/logger';

interface GlobalStatsDB extends DBSchema {
  stats: {
    key: string;
    value: GlobalStats;
  };
}

const DB_NAME = 'DocHub_GlobalStats';
const DB_VERSION = 1;
const STATS_STORE = 'stats';
const STATS_KEY = 'global';

const GlobalStatsContext = createContext<GlobalStatsContextType | undefined>(undefined);

export function GlobalStatsProvider({ children }: { children: ReactNode }) {
  const log = logger.namespace('GlobalStats');
  const [stats, setStats] = useState<GlobalStats>(createDefaultGlobalStats());
  const [isLoading, setIsLoading] = useState(true);
  const [db, setDb] = useState<IDBPDatabase<GlobalStatsDB> | null>(null);

  // Initialize IndexedDB
  useEffect(() => {
    const initDB = async () => {
      try {
        const database = await openDB<GlobalStatsDB>(DB_NAME, DB_VERSION, {
          upgrade(db: IDBPDatabase<GlobalStatsDB>) {
            if (!db.objectStoreNames.contains(STATS_STORE)) {
              db.createObjectStore(STATS_STORE);
            }
          },
        });

        setDb(database);

        // Load existing stats
        const existingStats = await database.get(STATS_STORE, STATS_KEY);
        if (existingStats) {
          // Check if we need to roll over to new day/week/month
          const updatedStats = checkAndRollOverPeriods(existingStats);
          setStats(updatedStats);

          // Save rolled-over stats if changed
          if (updatedStats !== existingStats) {
            await database.put(STATS_STORE, updatedStats, STATS_KEY);
          }
        } else {
          // No existing stats, save defaults
          const defaultStats = createDefaultGlobalStats();
          await database.put(STATS_STORE, defaultStats, STATS_KEY);
          setStats(defaultStats);
        }
      } catch (error) {
        log.error('Failed to initialize GlobalStats IndexedDB:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initDB();
  }, [log]); // Include log in dependencies for exhaustive-deps compliance

  // Cleanup database connection on unmount
  useEffect(() => {
    return () => {
      if (db) {
        log.debug('Closing GlobalStats database connection');
        db.close();
      }
    };
  }, [db]);

  // Check if we need to roll over to new day/week/month
  const checkAndRollOverPeriods = (currentStats: GlobalStats): GlobalStats => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentMonth = today.substring(0, 7);

    let updated = { ...currentStats };

    // Check if new day
    if (updated.today.date !== today) {
      // Archive yesterday's stats
      updated.dailyHistory = [updated.today, ...updated.dailyHistory].slice(0, 30);

      // Create new today
      updated.today = createEmptyDailyStats(today);
    }

    // Check if new week
    const monday = getMonday(now).toISOString().split('T')[0];
    if (updated.currentWeek.weekStart !== monday) {
      // Archive last week's stats
      updated.weeklyHistory = [updated.currentWeek, ...updated.weeklyHistory].slice(0, 12);

      // Create new week
      const sunday = getSunday(now).toISOString().split('T')[0];
      updated.currentWeek = createEmptyWeeklyStats(monday, sunday);
    }

    // Check if new month
    if (updated.currentMonth.month !== currentMonth) {
      // Archive last month's stats
      updated.monthlyHistory = [updated.currentMonth, ...updated.monthlyHistory].slice(0, 12);

      // Create new month
      updated.currentMonth = createEmptyMonthlyStats(currentMonth);
    }

    return updated;
  };

  // Update stats
  const updateStats = useCallback(
    async (update: StatsUpdate) => {
      if (!db) return;

      setStats((prevStats) => {
        const updatedStats = { ...prevStats };

        // Update all-time totals
        if (update.documentsProcessed) {
          updatedStats.allTime.documentsProcessed += update.documentsProcessed;
        }
        if (update.hyperlinksChecked) {
          updatedStats.allTime.hyperlinksChecked += update.hyperlinksChecked;
        }
        if (update.feedbackImported) {
          updatedStats.allTime.feedbackImported += update.feedbackImported;
        }
        if (update.timeSaved) {
          updatedStats.allTime.timeSaved += update.timeSaved;
        }

        // Set first/last activity dates
        const now = new Date().toISOString();
        if (!updatedStats.allTime.firstActivityDate) {
          updatedStats.allTime.firstActivityDate = now;
        }
        updatedStats.allTime.lastActivityDate = now;

        // Update today's stats
        if (update.documentsProcessed) {
          updatedStats.today.documentsProcessed += update.documentsProcessed;
        }
        if (update.hyperlinksChecked) {
          updatedStats.today.hyperlinksChecked += update.hyperlinksChecked;
        }
        if (update.feedbackImported) {
          updatedStats.today.feedbackImported += update.feedbackImported;
        }
        if (update.timeSaved) {
          updatedStats.today.timeSaved += update.timeSaved;
        }

        // Update current week stats
        if (update.documentsProcessed) {
          updatedStats.currentWeek.documentsProcessed += update.documentsProcessed;
        }
        if (update.hyperlinksChecked) {
          updatedStats.currentWeek.hyperlinksChecked += update.hyperlinksChecked;
        }
        if (update.feedbackImported) {
          updatedStats.currentWeek.feedbackImported += update.feedbackImported;
        }
        if (update.timeSaved) {
          updatedStats.currentWeek.timeSaved += update.timeSaved;
        }

        // Update current month stats
        if (update.documentsProcessed) {
          updatedStats.currentMonth.documentsProcessed += update.documentsProcessed;
        }
        if (update.hyperlinksChecked) {
          updatedStats.currentMonth.hyperlinksChecked += update.hyperlinksChecked;
        }
        if (update.feedbackImported) {
          updatedStats.currentMonth.feedbackImported += update.feedbackImported;
        }
        if (update.timeSaved) {
          updatedStats.currentMonth.timeSaved += update.timeSaved;
        }

        updatedStats.lastUpdated = now;

        // Persist to IndexedDB
        db.put(STATS_STORE, updatedStats, STATS_KEY).catch((error: Error) =>
          log.error('Failed to save stats:', error)
        );

        return updatedStats;
      });
    },
    [db]
  );

  // Get methods
  const getTodayStats = useCallback((): DailyStats => stats.today, [stats]);
  const getWeekStats = useCallback((): WeeklyStats => stats.currentWeek, [stats]);
  const getMonthStats = useCallback((): MonthlyStats => stats.currentMonth, [stats]);

  const getDailyHistory = useCallback(
    (days: number = 30): DailyStats[] => {
      return [stats.today, ...stats.dailyHistory].slice(0, days);
    },
    [stats]
  );

  const getWeeklyHistory = useCallback(
    (weeks: number = 12): WeeklyStats[] => {
      return [stats.currentWeek, ...stats.weeklyHistory].slice(0, weeks);
    },
    [stats]
  );

  const getMonthlyHistory = useCallback(
    (months: number = 12): MonthlyStats[] => {
      return [stats.currentMonth, ...stats.monthlyHistory].slice(0, months);
    },
    [stats]
  );

  // Comparison methods
  const getTodayChange = useCallback((): StatsUpdate => {
    const yesterday = stats.dailyHistory[0];
    if (!yesterday) {
      return {
        documentsProcessed: stats.today.documentsProcessed,
        hyperlinksChecked: stats.today.hyperlinksChecked,
        feedbackImported: stats.today.feedbackImported,
        timeSaved: stats.today.timeSaved,
      };
    }

    return {
      documentsProcessed: stats.today.documentsProcessed - yesterday.documentsProcessed,
      hyperlinksChecked: stats.today.hyperlinksChecked - yesterday.hyperlinksChecked,
      feedbackImported: stats.today.feedbackImported - yesterday.feedbackImported,
      timeSaved: stats.today.timeSaved - yesterday.timeSaved,
    };
  }, [stats]);

  const getWeekChange = useCallback((): StatsUpdate => {
    const lastWeek = stats.weeklyHistory[0];
    if (!lastWeek) {
      return {
        documentsProcessed: stats.currentWeek.documentsProcessed,
        hyperlinksChecked: stats.currentWeek.hyperlinksChecked,
        feedbackImported: stats.currentWeek.feedbackImported,
        timeSaved: stats.currentWeek.timeSaved,
      };
    }

    return {
      documentsProcessed: stats.currentWeek.documentsProcessed - lastWeek.documentsProcessed,
      hyperlinksChecked: stats.currentWeek.hyperlinksChecked - lastWeek.hyperlinksChecked,
      feedbackImported: stats.currentWeek.feedbackImported - lastWeek.feedbackImported,
      timeSaved: stats.currentWeek.timeSaved - lastWeek.timeSaved,
    };
  }, [stats]);

  const getMonthChange = useCallback((): StatsUpdate => {
    const lastMonth = stats.monthlyHistory[0];
    if (!lastMonth) {
      return {
        documentsProcessed: stats.currentMonth.documentsProcessed,
        hyperlinksChecked: stats.currentMonth.hyperlinksChecked,
        feedbackImported: stats.currentMonth.feedbackImported,
        timeSaved: stats.currentMonth.timeSaved,
      };
    }

    return {
      documentsProcessed: stats.currentMonth.documentsProcessed - lastMonth.documentsProcessed,
      hyperlinksChecked: stats.currentMonth.hyperlinksChecked - lastMonth.hyperlinksChecked,
      feedbackImported: stats.currentMonth.feedbackImported - lastMonth.feedbackImported,
      timeSaved: stats.currentMonth.timeSaved - lastMonth.timeSaved,
    };
  }, [stats]);

  // Reset all stats
  const resetAllStats = useCallback(async () => {
    if (!db) return;

    const freshStats = createDefaultGlobalStats();
    setStats(freshStats);
    await db.put(STATS_STORE, freshStats, STATS_KEY);
  }, [db]);

  return (
    <GlobalStatsContext.Provider
      value={{
        stats,
        updateStats,
        getTodayStats,
        getWeekStats,
        getMonthStats,
        getDailyHistory,
        getWeeklyHistory,
        getMonthlyHistory,
        getTodayChange,
        getWeekChange,
        getMonthChange,
        resetAllStats,
        isLoading,
      }}
    >
      {children}
    </GlobalStatsContext.Provider>
  );
}

export function useGlobalStats() {
  const context = useContext(GlobalStatsContext);
  if (context === undefined) {
    throw new Error('useGlobalStats must be used within a GlobalStatsProvider');
  }
  return context;
}

// Helper functions
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getSunday(date: Date): Date {
  const monday = getMonday(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}
