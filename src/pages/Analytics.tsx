import { useState } from 'react';
import { motion } from 'framer-motion';
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
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useGlobalStats } from '@/contexts/GlobalStatsContext';
import { cn } from '@/utils/cn';
import {
  TrendingUp,
  BarChart3,
  Calendar,
  CalendarDays,
  CalendarRange,
  RotateCcw,
  FileCheck,
  Link,
  MessageSquare,
  Clock,
} from 'lucide-react';

type ViewMode = 'daily' | 'weekly' | 'monthly';

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

export function Analytics() {
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const {
    stats,
    getDailyHistory,
    getWeeklyHistory,
    getMonthlyHistory,
    resetAllStats,
  } = useGlobalStats();

  const handleResetStats = async () => {
    setIsResetting(true);
    try {
      await resetAllStats();
      setShowResetDialog(false);
    } catch (error) {
      console.error('Failed to reset stats:', error);
    } finally {
      setIsResetting(false);
    }
  };

  // Prepare chart data based on view mode
  const getChartData = () => {
    if (viewMode === 'daily') {
      const history = getDailyHistory(30);
      return [...history].reverse().map((day) => ({
        date: new Date(day.date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
        Documents: day.documentsProcessed,
        Hyperlinks: day.hyperlinksChecked,
        Feedback: day.feedbackImported,
        'Time (min)': day.timeSaved,
      }));
    } else if (viewMode === 'weekly') {
      const history = getWeeklyHistory(12);
      return [...history].reverse().map((week) => ({
        date: `${new Date(week.weekStart).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })} - ${new Date(week.weekEnd).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })}`,
        Documents: week.documentsProcessed,
        Hyperlinks: week.hyperlinksChecked,
        Feedback: week.feedbackImported,
        'Time (min)': week.timeSaved,
      }));
    } else {
      const history = getMonthlyHistory(12);
      return [...history].reverse().map((month) => ({
        date: new Date(month.month + '-01').toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        }),
        Documents: month.documentsProcessed,
        Hyperlinks: month.hyperlinksChecked,
        Feedback: month.feedbackImported,
        'Time (min)': month.timeSaved,
      }));
    }
  };

  const chartData = getChartData();

  const viewModes = [
    {
      value: 'daily' as ViewMode,
      label: 'Daily',
      icon: Calendar,
      description: 'Last 30 days',
    },
    {
      value: 'weekly' as ViewMode,
      label: 'Weekly',
      icon: CalendarDays,
      description: 'Last 12 weeks',
    },
    {
      value: 'monthly' as ViewMode,
      label: 'Monthly',
      icon: CalendarRange,
      description: 'Last 12 months',
    },
  ];

  const statsSummary = [
    {
      title: 'Documents Processed',
      value: stats.allTime.documentsProcessed,
      icon: FileCheck,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
    {
      title: 'Hyperlinks Checked',
      value: stats.allTime.hyperlinksChecked,
      icon: Link,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'Feedback Imported',
      value: stats.allTime.feedbackImported,
      icon: MessageSquare,
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
    },
    {
      title: 'Time Saved',
      value: `${stats.allTime.timeSaved}m`,
      icon: Clock,
      color: 'text-orange-500',
      bgColor: 'bg-orange-500/10',
    },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="p-6 space-y-6 max-w-[1400px] mx-auto"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
            <BarChart3 className="w-8 h-8" />
            Analytics
          </h1>
          <p className="text-muted-foreground">
            Visualize your productivity trends and insights
          </p>
        </div>
        <Button
          variant="destructive"
          onClick={() => setShowResetDialog(true)}
          className="gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          Reset All Stats
        </Button>
      </motion.div>

      {/* Stats Summary */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsSummary.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} className="border-border/50">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">{stat.title}</p>
                    <p className="text-2xl font-bold">{stat.value}</p>
                  </div>
                  <div className={cn('p-3 rounded-lg', stat.bgColor)}>
                    <Icon className={cn('w-6 h-6', stat.color)} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </motion.div>

      {/* View Mode Selector */}
      <motion.div variants={itemVariants} className="flex gap-2">
        {viewModes.map((mode) => {
          const Icon = mode.icon;
          return (
            <Button
              key={mode.value}
              variant={viewMode === mode.value ? 'default' : 'outline'}
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
      <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Line Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Trends Over Time
            </CardTitle>
            <CardDescription>
              Track your productivity metrics across {viewMode === 'daily' ? 'days' : viewMode === 'weekly' ? 'weeks' : 'months'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--background))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="Documents"
                  stroke="hsl(142, 76%, 36%)"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
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
            <CardDescription>
              Compare different metrics side by side
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--background))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Bar dataKey="Feedback" fill="hsl(280, 100%, 70%)" />
                <Bar dataKey="Time (min)" fill="hsl(25, 95%, 53%)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </motion.div>

      {/* Reset Confirmation Dialog */}
      <ConfirmDialog
        open={showResetDialog}
        onOpenChange={setShowResetDialog}
        onConfirm={handleResetStats}
        title="Reset All Statistics?"
        message="This will permanently delete all historical data including daily, weekly, and monthly statistics. Your all-time totals will be reset to zero. This action cannot be undone."
        confirmText="Reset All Stats"
        variant="destructive"
        loading={isResetting}
      />
    </motion.div>
  );
}
