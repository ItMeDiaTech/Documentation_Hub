import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
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
import { loadGlobalStats, saveGlobalStats, resetGlobalStats } from '@/utils/indexedDB';
import { logger } from '@/utils/logger';

const GlobalStatsContext = createContext<GlobalStatsContextType | undefined>(undefined);

export function GlobalStatsProvider({ children }: { children: ReactNode }) {
  const log = logger.namespace('GlobalStats');
  const [stats, setStats] = useState<GlobalStats>(createDefaultGlobalStats());
  const [isLoading, setIsLoading] = useState(true);

  // Initialize GlobalStats - Load from IndexedDB using connection pool
  useEffect(() => {
    let isMounted = true;

    const initStats = async () => {
      try {
        // Load existing stats using connection pool
        const existingStats = await loadGlobalStats();

        // Only update state if component is still mounted
        if (!isMounted) return;

        if (existingStats) {
          // Check if we need to roll over to new day/week/month
          const updatedStats = checkAndRollOverPeriods(existingStats);
          setStats(updatedStats);

          // Save rolled-over stats if changed
          if (updatedStats !== existingStats) {
            await saveGlobalStats(updatedStats);
          }
        } else {
          // No existing stats, save defaults
          const defaultStats = createDefaultGlobalStats();
          await saveGlobalStats(defaultStats);
          setStats(defaultStats);
        }
      } catch (error) {
        if (isMounted) {
          log.error('Failed to initialize GlobalStats:', error);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initStats();

    // Cleanup: mark component as unmounted (connection pool handles db cleanup)
    return () => {
      isMounted = false;
    };
  }, []); // Empty deps = runs once on mount, cleanup on unmount

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

        // Persist to IndexedDB using connection pool
        saveGlobalStats(updatedStats).catch((error: Error) =>
          log.error('Failed to save stats:', error)
        );

        return updatedStats;
      });
    },
    [log]
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
    const freshStats = createDefaultGlobalStats();
    setStats(freshStats);
    await resetGlobalStats(freshStats);
  }, []);

  // PERFORMANCE FIX: Memoize provider value to prevent unnecessary re-renders
  // This prevents all consumers (Dashboard, Analytics, etc.) from re-rendering
  // on every stats update when the methods haven't changed
  const contextValue = useMemo(() => ({
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
  }), [
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
  ]);

  return (
    <GlobalStatsContext.Provider value={contextValue}>
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
