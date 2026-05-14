import { useState, useMemo, useCallback, memo } from "react";
import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { useGlobalStats } from "@/contexts/GlobalStatsContext";
import { cn } from "@/utils/cn";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  TrendingUp,
  BarChart3,
  Calendar,
  CalendarDays,
  CalendarRange,
  FileCheck,
  Link,
  MessageSquare,
  Clock,
  RotateCcw,
} from "lucide-react";

type ViewMode = "daily" | "weekly" | "monthly";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
    },
  },
};

// Type for chart hover data
interface HoveredChartData {
  date: string;
  Documents?: number;
  Hyperlinks?: number;
  Feedback?: number;
  "Time (min)"?: number;
}

// PERFORMANCE: Wrap in memo to prevent re-renders when parent state changes
export const Analytics = memo(function Analytics() {
  const [viewMode, setViewMode] = useState<ViewMode>("daily");
  const [hoveredData, setHoveredData] = useState<HoveredChartData | null>(null);
  const [showResetStatsDialog, setShowResetStatsDialog] = useState(false);
  const [isResettingStats, setIsResettingStats] = useState(false);

  const { stats, resetAllStats, getDailyHistory, getWeeklyHistory, getMonthlyHistory } = useGlobalStats();

  const handleResetStats = async () => {
    setIsResettingStats(true);
    try {
      await resetAllStats();
    } finally {
      setIsResettingStats(false);
    }
  };

  // Prepare chart data based on view mode
  // PERFORMANCE FIX: Memoize chart data to prevent unnecessary recalculations
  // Recharts will re-render only when data actually changes, not on every parent render
  // Parse YYYY-MM-DD date strings as LOCAL timezone (not UTC).
  // new Date("2026-04-12") is UTC midnight, which shifts to the previous day
  // in US timezones. Appending T00:00:00 forces local timezone interpretation.
  const parseLocalDate = (dateStr: string) => new Date(dateStr + "T00:00:00");

  const chartData = useMemo(() => {
    if (viewMode === "daily") {
      const history = getDailyHistory(30);
      return [...history].reverse().map((day) => ({
        date: parseLocalDate(day.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        Documents: day.documentsProcessed,
        Hyperlinks: day.hyperlinksChecked,
        Feedback: day.feedbackImported,
        "Time (min)": day.timeSaved,
      }));
    } else if (viewMode === "weekly") {
      const history = getWeeklyHistory(12);
      return [...history].reverse().map((week) => ({
        date: `${parseLocalDate(week.weekStart).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })} - ${parseLocalDate(week.weekEnd).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}`,
        Documents: week.documentsProcessed,
        Hyperlinks: week.hyperlinksChecked,
        Feedback: week.feedbackImported,
        "Time (min)": week.timeSaved,
      }));
    } else {
      const history = getMonthlyHistory(12);
      return [...history].reverse().map((month) => ({
        date: parseLocalDate(month.month + "-01").toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        }),
        Documents: month.documentsProcessed,
        Hyperlinks: month.hyperlinksChecked,
        Feedback: month.feedbackImported,
        "Time (min)": month.timeSaved,
      }));
    }
  }, [viewMode, getDailyHistory, getWeeklyHistory, getMonthlyHistory]);

  // Handle chart hover via mouse events instead of state updates during render
  // Recharts 3.x removed activePayload — use activeTooltipIndex to index into chartData
  const handleChartMouseMove = useCallback((state: any) => {
    if (state?.activeTooltipIndex !== undefined && state.activeTooltipIndex >= 0) {
      const data = chartData[state.activeTooltipIndex];
      if (data) {
        setHoveredData(data);
      }
    }
  }, [chartData]);

  const handleChartMouseLeave = useCallback(() => {
    setHoveredData(null);
  }, []);

  const viewModes = [
    {
      value: "daily" as ViewMode,
      label: "Daily",
      icon: Calendar,
      description: "Last 30 days",
    },
    {
      value: "weekly" as ViewMode,
      label: "Weekly",
      icon: CalendarDays,
      description: "Last 12 weeks",
    },
    {
      value: "monthly" as ViewMode,
      label: "Monthly",
      icon: CalendarRange,
      description: "Last 12 months",
    },
  ];

  const statsSummary = [
    {
      title: "Documents Processed",
      value: stats.allTime.documentsProcessed,
      icon: FileCheck,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
    },
    {
      title: "Hyperlinks Checked",
      value: stats.allTime.hyperlinksChecked,
      icon: Link,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      title: "Feedback Imported",
      value: stats.allTime.feedbackImported,
      icon: MessageSquare,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
    {
      title: "Hyperlink Time Saved",
      value: `${stats.allTime.timeSaved}m`,
      icon: Clock,
      color: "text-orange-500",
      bgColor: "bg-orange-500/10",
    },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="p-6 space-y-6 max-w-[1400px] mx-auto"
    >
      {/* Sticky Header Section - includes title and stats */}
      <div className="sticky top-0 z-10 bg-background -mx-6 px-6 pb-4 border-b border-border/50">
        {/* Header */}
        <motion.div variants={itemVariants} className="flex items-center justify-between pt-0 pb-4">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold mb-1 flex items-center gap-2">
                  <BarChart3 className="w-8 h-8" />
                  Analytics
                </h1>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowResetStatsDialog(true)}
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                >
                  Reset Stats
                </Button>
              </div>
              <p className="text-muted-foreground">Track performance and insights</p>
            </div>
            <div className="h-12 w-px bg-border" />
            {hoveredData ? (
              <div className="text-base font-medium flex items-center gap-4">
                <span className="text-muted-foreground">{hoveredData.date}:</span>
                {hoveredData.Documents !== undefined && (
                  <span className="text-green-500">Docs: {hoveredData.Documents}</span>
                )}
                {hoveredData.Hyperlinks !== undefined && (
                  <span className="text-blue-500">Links: {hoveredData.Hyperlinks}</span>
                )}
                {hoveredData.Feedback !== undefined && (
                  <span className="text-purple-500">Feedback: {hoveredData.Feedback}</span>
                )}
                {hoveredData["Time (min)"] !== undefined && (
                  <span className="text-orange-500">Time: {hoveredData["Time (min)"]}m</span>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground italic text-sm">
                Hover over charts for details
              </span>
            )}
          </div>
        </motion.div>

        {/* Stats Summary */}
        <motion.div
          variants={itemVariants}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {statsSummary.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.title} className="border-border/50">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-foreground mb-1">{stat.title}</p>
                      <p className="text-2xl font-bold">{stat.value}</p>
                    </div>
                    <div className={cn("p-3 rounded-lg", stat.bgColor)}>
                      <Icon className={cn("w-6 h-6", stat.color)} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </motion.div>
      </div>

      {/* View Mode Selector */}
      <motion.div variants={itemVariants} className="flex gap-2">
        {viewModes.map((mode) => {
          const Icon = mode.icon;
          return (
            <Button
              key={mode.value}
              variant={viewMode === mode.value ? "default" : "outline"}
              onClick={() => setViewMode(mode.value)}
              className="flex-1 gap-2"
            >
              <Icon className="w-4 h-4" />
              <div className="flex flex-col items-start">
                <span className="font-semibold">{mode.label}</span>
                <span className="text-xs opacity-70">{mode.description}</span>
              </div>
            </Button>
          );
        })}
      </motion.div>

      {/* Charts */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 gap-6">
        {/* Documents Processed Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Documents Processed Over Time
            </CardTitle>
            <CardDescription>
              Track document processing trends across{" "}
              {viewMode === "daily" ? "days" : viewMode === "weekly" ? "weeks" : "months"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={chartData}
                onMouseMove={handleChartMouseMove}
                onMouseLeave={handleChartMouseLeave}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "var(--color-foreground)" }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis tick={{ fontSize: 12, fill: "var(--color-foreground)" }} />
                <Tooltip content={() => null} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="Documents"
                  stroke="hsl(142, 76%, 36%)"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Hyperlinks Checked Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Hyperlinks Checked Over Time
            </CardTitle>
            <CardDescription>
              Track hyperlink validation trends across{" "}
              {viewMode === "daily" ? "days" : viewMode === "weekly" ? "weeks" : "months"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={chartData}
                onMouseMove={handleChartMouseMove}
                onMouseLeave={handleChartMouseLeave}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "var(--color-foreground)" }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis tick={{ fontSize: 12, fill: "var(--color-foreground)" }} />
                <Tooltip content={() => null} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="Hyperlinks"
                  stroke="hsl(221, 83%, 53%)"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Activity Breakdown
            </CardTitle>
            <CardDescription>Compare different metrics side by side</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={chartData}
                onMouseMove={handleChartMouseMove}
                onMouseLeave={handleChartMouseLeave}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "var(--color-foreground)" }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis tick={{ fontSize: 12, fill: "var(--color-foreground)" }} />
                <Tooltip content={() => null} />
                <Legend />
                <Bar dataKey="Feedback" fill="hsl(280, 100%, 70%)" />
                <Bar dataKey="Time (min)" fill="hsl(25, 95%, 53%)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </motion.div>

      <ConfirmDialog
        open={showResetStatsDialog}
        onOpenChange={setShowResetStatsDialog}
        onConfirm={handleResetStats}
        title="Reset All Statistics"
        message="This will permanently delete all analytics data including daily, weekly, and monthly history. This action cannot be undone."
        confirmText="Reset All Stats"
        variant="destructive"
        loading={isResettingStats}
      />
    </motion.div>
  );
});
