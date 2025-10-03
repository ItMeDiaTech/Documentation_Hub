import { motion } from 'framer-motion';
import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import {
  FileCheck,
  Link,
  MessageSquare,
  Clock,
  Plus,
  FolderOpen,
  Calendar,
  FileText,
  ArrowUpRight,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useSession } from '@/contexts/SessionContext';
import { useNavigate } from 'react-router-dom';
import { SessionManager } from '@/components/sessions/SessionManager';

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

export function Dashboard() {
  const { recentSessions, loadSession } = useSession();
  const navigate = useNavigate();
  const [showSessionManager, setShowSessionManager] = useState(false);
  const [sessionManagerMode, setSessionManagerMode] = useState<'new' | 'load'>('new');

  // Calculate total stats from all sessions
  const totalStats = recentSessions.reduce(
    (acc, session) => ({
      documentsProcessed: acc.documentsProcessed + session.stats.documentsProcessed,
      hyperlinksChecked: acc.hyperlinksChecked + session.stats.hyperlinksChecked,
      feedbackImported: acc.feedbackImported + session.stats.feedbackImported,
      timeSaved: acc.timeSaved + session.stats.timeSaved,
    }),
    { documentsProcessed: 0, hyperlinksChecked: 0, feedbackImported: 0, timeSaved: 0 }
  );

  const stats = [
    {
      title: 'Documents Processed',
      value: totalStats.documentsProcessed.toString(),
      change: '+12',
      trend: 'up',
      icon: FileCheck,
      gradient: 'from-green-400 to-emerald-600',
      bgGradient: 'from-green-500/20 to-emerald-500/10',
    },
    {
      title: 'Hyperlinks Checked',
      value: totalStats.hyperlinksChecked.toString(),
      change: '+245',
      trend: 'up',
      icon: Link,
      gradient: 'from-blue-400 to-indigo-600',
      bgGradient: 'from-blue-500/20 to-indigo-500/10',
    },
    {
      title: 'Feedback Imported',
      value: totalStats.feedbackImported.toString(),
      change: '+8',
      trend: 'up',
      icon: MessageSquare,
      gradient: 'from-purple-400 to-pink-600',
      bgGradient: 'from-purple-500/20 to-pink-500/10',
    },
    {
      title: 'Time Saved',
      value: `${totalStats.timeSaved}m`,
      change: '+45m',
      trend: 'up',
      icon: Clock,
      gradient: 'from-orange-400 to-red-600',
      bgGradient: 'from-orange-500/20 to-red-500/10',
    },
  ];

  const handleNewSession = () => {
    setSessionManagerMode('new');
    setShowSessionManager(true);
  };

  const handleLoadSession = () => {
    setSessionManagerMode('load');
    setShowSessionManager(true);
  };

  const handleSessionCreated = (sessionId: string) => {
    navigate(`/session/${sessionId}`);
  };

  const handleRecentSessionClick = (sessionId: string) => {
    loadSession(sessionId);
    navigate(`/session/${sessionId}`);
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (hours < 1) {
      const minutes = Math.floor(diff / (1000 * 60));
      return `${minutes} minutes ago`;
    } else if (hours < 24) {
      return `${hours} hours ago`;
    } else {
      const days = Math.floor(hours / 24);
      return `${days} day${days > 1 ? 's' : ''} ago`;
    }
  };

  return (
    <motion.div
      className="p-6 space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div className="flex justify-end" variants={itemVariants}>
        <div className="flex gap-2">
          <Button
            onClick={handleNewSession}
            variant="default"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
          >
            New Session
          </Button>
          <Button
            onClick={handleLoadSession}
            variant="outline"
            size="sm"
            icon={<FolderOpen className="w-4 h-4" />}
          >
            Load Session
          </Button>
        </div>
      </motion.div>

      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
        variants={itemVariants}
      >
        {stats.map((stat) => {
          const Icon = stat.icon;

          return (
            <motion.div key={stat.title} whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
              <Card className="relative overflow-hidden group cursor-pointer border-0 shadow-lg hover:shadow-2xl transition-all">
                <div
                  className={cn(
                    'absolute inset-0 bg-gradient-to-br opacity-5 group-hover:opacity-10 transition-opacity',
                    stat.bgGradient
                  )}
                />
                <CardContent className="p-6 relative">
                  <div className="flex items-center justify-between mb-4">
                    <div
                      className={cn('p-3 rounded-xl bg-gradient-to-br', stat.gradient, 'shadow-lg')}
                    >
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      className="p-2 rounded-lg hover:bg-muted transition-colors"
                    >
                      <ArrowUpRight className="w-4 h-4 text-muted-foreground" />
                    </motion.button>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {stat.title}
                    </p>
                    <p className="text-3xl font-bold tracking-tight">{stat.value}</p>
                    <div className="flex items-center gap-2 pt-2">
                      <div
                        className={cn(
                          'flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
                          'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        )}
                      >
                        <span>{stat.change}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">today</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle>Recent Sessions</CardTitle>
            <CardDescription>Your recently accessed document processing sessions</CardDescription>
          </CardHeader>
          <CardContent>
            {recentSessions.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No sessions yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Create a new session to start processing documents
                </p>
                <Button
                  onClick={handleNewSession}
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  icon={<Plus className="w-4 h-4" />}
                >
                  Create First Session
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {recentSessions.map((session) => (
                  <motion.div
                    key={session.id}
                    className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted/50 transition-all cursor-pointer group"
                    whileHover={{ x: 4 }}
                    onClick={() => handleRecentSessionClick(session.id)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <FileText className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-lg font-medium">{session.name}</p>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <FileCheck className="w-3 h-3" />
                            {session.documents.length} documents
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDate(session.lastModified)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-xs px-2 py-1 rounded-full',
                          session.status === 'active'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                        )}
                      >
                        {session.status}
                      </span>
                      <ArrowUpRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {showSessionManager && (
        <SessionManager
          mode={sessionManagerMode}
          onClose={() => setShowSessionManager(false)}
          onSessionCreated={handleSessionCreated}
          onSessionLoaded={handleSessionCreated}
        />
      )}
    </motion.div>
  );
}
