import { memo, useCallback, CSSProperties } from 'react';
// @ts-ignore - react-window exports these despite TypeScript not recognizing them
import { FixedSizeList as List } from 'react-window';
import { motion } from 'framer-motion';
import { FolderOpen, FileText, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { Session } from '@/types/session';
import { cn } from '@/utils/cn';
import { useNavigate } from 'react-router-dom';

interface VirtualSessionListProps {
  sessions: Session[];
  height: number;
  onSessionClick?: (session: Session) => void;
  selectedSessionId?: string;
}

interface SessionRowProps {
  index: number;
  style: CSSProperties;
  data: {
    sessions: Session[];
    onSessionClick?: (session: Session) => void;
    selectedSessionId?: string;
    navigate: ReturnType<typeof useNavigate>;
  };
}

/**
 * Individual session row component
 * Memoized to prevent unnecessary re-renders
 */
const SessionRow = memo(({ index, style, data }: SessionRowProps) => {
  const session = data.sessions[index];
  const isSelected = session.id === data.selectedSessionId;

  const handleClick = useCallback(() => {
    if (data.onSessionClick) {
      data.onSessionClick(session);
    }
    data.navigate(`/session/${session.id}`);
  }, [session, data]);

  const getStatusIcon = () => {
    switch (session.status) {
      case 'active':
        return <FolderOpen className="w-4 h-4 text-primary" />;
      case 'closed':
        return <CheckCircle className="w-4 h-4 text-muted-foreground" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const documentCount = session.documents?.length || 0;
  const processedCount = session.documents?.filter(d => d.status === 'completed').length || 0;

  return (
    <div style={style}>
      <motion.div
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={handleClick}
        className={cn(
          "mx-2 p-4 rounded-lg border cursor-pointer transition-all",
          "hover:shadow-md hover:border-primary/30",
          isSelected && "border-primary bg-primary/5",
          !isSelected && "border-border bg-card"
        )}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              <h3 className="font-semibold text-sm">{session.name}</h3>
              {session.status === 'active' && (
                <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full">
                  Active
                </span>
              )}
            </div>

            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <FileText className="w-3 h-3" />
                <span>{documentCount} documents</span>
              </div>

              {processedCount > 0 && (
                <div className="flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  <span>{processedCount} processed</span>
                </div>
              )}

              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>{new Date(session.lastModified).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Progress bar for processed documents */}
            {documentCount > 0 && (
              <div className="mt-2 w-full bg-muted rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all"
                  style={{ width: `${(processedCount / documentCount) * 100}%` }}
                />
              </div>
            )}
          </div>

          <div className="text-right text-xs text-muted-foreground">
            {session.stats?.timeSaved && (
              <div>{Math.round(session.stats.timeSaved / 60)} min saved</div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
});

SessionRow.displayName = 'SessionRow';

/**
 * Virtual scrolling session list component
 * Efficiently renders large lists of sessions
 */
export const VirtualSessionList = memo(function VirtualSessionList({
  sessions,
  height,
  onSessionClick,
  selectedSessionId,
}: VirtualSessionListProps) {
  const navigate = useNavigate();

  // Data passed to each row
  const itemData = {
    sessions,
    onSessionClick,
    selectedSessionId,
    navigate,
  };

  return (
    <List
      height={height}
      itemCount={sessions.length}
      itemSize={120} // Height of each session row
      width="100%"
      itemData={itemData}
      className="scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
    >
      {SessionRow}
    </List>
  );
});