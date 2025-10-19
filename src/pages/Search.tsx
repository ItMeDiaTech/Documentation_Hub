import { useState, useMemo, useEffect, useRef, memo } from 'react';
import { motion } from 'framer-motion';
import Fuse from 'fuse.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { useSession } from '@/contexts/SessionContext';
import { cn } from '@/utils/cn';
import {
  Search as SearchIcon,
  Filter,
  FileText,
  Calendar,
  FolderOpen,
  CheckCircle2,
  Clock,
  XCircle,
  ChevronRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Document } from '@/types/session';

type StatusFilter = 'all' | 'completed' | 'pending' | 'error';
type DateRange = 'all' | 'today' | 'week' | 'month' | 'custom';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
    },
  },
};

// PERFORMANCE: Wrap in memo to prevent re-renders when parent state changes
export const Search = memo(function Search() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedSessionId, setSelectedSessionId] = useState<string>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const { sessions } = useSession();
  const navigate = useNavigate();
  const resultsRef = useRef<HTMLDivElement>(null);

  // Flatten all documents from all sessions
  const allDocuments = useMemo(() => {
    const docs: Array<Document & { sessionId: string; sessionName: string }> = [];
    sessions.forEach((session) => {
      session.documents.forEach((doc) => {
        docs.push({
          ...doc,
          sessionId: session.id,
          sessionName: session.name,
        });
      });
    });
    return docs;
  }, [sessions]);

  // Configure Fuse.js for fuzzy search
  const fuse = useMemo(() => {
    return new Fuse(allDocuments, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'sessionName', weight: 1 },
        { name: 'path', weight: 0.5 },
      ],
      threshold: 0.4,
      includeScore: true,
    });
  }, [allDocuments]);

  // Filter and search documents
  const filteredDocuments = useMemo(() => {
    let results = searchQuery
      ? fuse.search(searchQuery).map((result) => result.item)
      : allDocuments;

    // Apply status filter
    if (statusFilter !== 'all') {
      results = results.filter((doc) => doc.status === statusFilter);
    }

    // Apply session filter
    if (selectedSessionId !== 'all') {
      results = results.filter((doc) => doc.sessionId === selectedSessionId);
    }

    return results;
  }, [searchQuery, statusFilter, selectedSessionId, fuse, allDocuments]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!filteredDocuments.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredDocuments.length - 1 ? prev + 1 : prev
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
      } else if (e.key === 'Enter' && filteredDocuments[selectedIndex]) {
        e.preventDefault();
        handleOpenDocument(filteredDocuments[selectedIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredDocuments, selectedIndex]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredDocuments]);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selectedElement = resultsRef.current.querySelector(
        `[data-index="${selectedIndex}"]`
      );
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  const handleOpenDocument = (doc: Document & { sessionId: string; sessionName: string }) => {
    navigate(`/session/${doc.sessionId}`);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <FileText className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const statusOptions = [
    { value: 'all' as StatusFilter, label: 'All Status', count: allDocuments.length },
    {
      value: 'completed' as StatusFilter,
      label: 'Completed',
      count: allDocuments.filter((d) => d.status === 'completed').length,
    },
    {
      value: 'pending' as StatusFilter,
      label: 'Pending',
      count: allDocuments.filter((d) => d.status === 'pending').length,
    },
    {
      value: 'error' as StatusFilter,
      label: 'Error',
      count: allDocuments.filter((d) => d.status === 'error').length,
    },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="p-6 space-y-6 max-w-[1200px] mx-auto"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <SearchIcon className="w-8 h-8" />
          Search Documents
        </h1>
        <p className="text-muted-foreground">
          Find documents across all sessions with advanced filtering
        </p>
      </motion.div>

      {/* Search Input */}
      <motion.div variants={itemVariants} className="space-y-4">
        <div className="relative">
          <Input
            type="text"
            placeholder="Search by document name, session, or path..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-12 h-12 text-lg"
            autoFocus
          />
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Button
            variant={showFilters ? 'default' : 'ghost'}
            size="icon"
            className="absolute right-2 top-1/2 -translate-y-1/2"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="w-4 h-4" />
          </Button>
        </div>

        {/* Filters */}
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg border border-border"
          >
            {/* Status Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <div className="flex gap-2 flex-wrap">
                {statusOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={statusFilter === option.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStatusFilter(option.value)}
                    className="gap-2"
                  >
                    {option.label}
                    <span className="text-xs opacity-70">({option.count})</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Session Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Session</label>
              <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-input bg-background"
              >
                <option value="all">All Sessions</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.name} ({session.documents.length})
                  </option>
                ))}
              </select>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Results Summary */}
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <p className="text-sm text-foreground">
          {filteredDocuments.length} {filteredDocuments.length === 1 ? 'result' : 'results'} found
          {searchQuery && (
            <span className="ml-1">
              for "<span className="font-semibold text-foreground">{searchQuery}</span>"
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          Use <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">↑</kbd>
          <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs ml-1">↓</kbd> to navigate,
          <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs ml-1">Enter</kbd> to open
        </p>
      </motion.div>

      {/* Results */}
      <motion.div variants={itemVariants} className="space-y-2" ref={resultsRef}>
        {filteredDocuments.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="pt-12 pb-12 text-center">
              <SearchIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-lg font-medium mb-1">No documents found</p>
              <p className="text-sm text-muted-foreground">
                Try adjusting your search query or filters
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredDocuments.map((doc, index) => (
            <motion.div
              key={`${doc.sessionId}-${doc.id}`}
              data-index={index}
              variants={itemVariants}
              onClick={() => handleOpenDocument(doc)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                'p-4 rounded-lg border cursor-pointer transition-all duration-150',
                'hover:border-primary hover:bg-accent/50',
                selectedIndex === index
                  ? 'border-primary bg-accent/50 shadow-xs'
                  : 'border-border bg-card'
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {getStatusIcon(doc.status)}
                    <h3 className="font-medium truncate">{doc.name}</h3>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-foreground">
                    <span className="flex items-center gap-1">
                      <FolderOpen className="w-3.5 h-3.5" />
                      {doc.sessionName}
                    </span>
                    {doc.processedAt && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(doc.processedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">{doc.path}</p>
                </div>
                <ChevronRight
                  className={cn(
                    'w-5 h-5 text-muted-foreground transition-transform',
                    selectedIndex === index && 'text-primary translate-x-1'
                  )}
                />
              </div>
            </motion.div>
          ))
        )}
      </motion.div>
    </motion.div>
  );
});
