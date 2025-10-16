import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle,
  XCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Filter,
  Search,
  ExternalLink,
  Hash
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { sanitizeUrl } from '@/utils/urlSanitizer';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';

interface HyperlinkChange {
  id: string;
  displayText: string;
  originalUrl: string;
  newUrl?: string;
  type: 'append' | 'update' | 'remove' | 'validate';
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  location: string; // e.g., "Main Document", "Header", "Footer"
  context?: string; // Surrounding text
  willAppendContentId?: boolean;
  contentId?: string;
}

interface HyperlinkPreviewProps {
  changes: HyperlinkChange[];
  onApprove?: (changeId: string) => void;
  onReject?: (changeId: string) => void;
  onApproveAll?: () => void;
  onRejectAll?: () => void;
  onApply?: () => void;
  isReadOnly?: boolean;
  className?: string;
}

export function HyperlinkPreview({
  changes,
  onApprove,
  onReject,
  onApproveAll,
  onRejectAll,
  onApply,
  isReadOnly = false,
  className
}: HyperlinkPreviewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'append' | 'update' | 'remove'>('all');
  const [showOnlyPending, setShowOnlyPending] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const filteredChanges = changes.filter(change => {
    if (filterType !== 'all' && change.type !== filterType) return false;
    if (showOnlyPending && change.status !== 'pending') return false;
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        change.displayText.toLowerCase().includes(search) ||
        change.originalUrl.toLowerCase().includes(search) ||
        change.newUrl?.toLowerCase().includes(search)
      );
    }
    return true;
  });

  const pendingCount = changes.filter(c => c.status === 'pending').length;
  const approvedCount = changes.filter(c => c.status === 'approved').length;
  const rejectedCount = changes.filter(c => c.status === 'rejected').length;

  const toggleExpanded = (id: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const getChangeIcon = (type: HyperlinkChange['type']) => {
    switch (type) {
      case 'append':
        return <Hash className="w-4 h-4 text-blue-500" />;
      case 'update':
        return <ArrowRight className="w-4 h-4 text-yellow-500" />;
      case 'remove':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'validate':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
  };

  const getStatusBadge = (status: HyperlinkChange['status']) => {
    switch (status) {
      case 'pending':
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-full">
            Pending
          </span>
        );
      case 'approved':
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
            Approved
          </span>
        );
      case 'rejected':
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
            Rejected
          </span>
        );
      case 'applied':
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
            Applied
          </span>
        );
    }
  };

  const truncateUrl = (url: string, maxLength: number = 50): string => {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + '...';
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">Hyperlink Changes Preview</h3>
          <p className="text-sm text-muted-foreground">
            Review and approve changes before applying
          </p>
        </div>
        {!isReadOnly && pendingCount > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRejectAll}
            >
              Reject All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onApproveAll}
            >
              Approve All
            </Button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="text-center p-3 bg-muted/30 rounded-lg">
          <p className="text-lg font-bold">{changes.length}</p>
          <p className="text-xs text-muted-foreground">Total Changes</p>
        </div>
        <div className="text-center p-3 bg-yellow-500/10 rounded-lg">
          <p className="text-lg font-bold text-yellow-600">{pendingCount}</p>
          <p className="text-xs text-muted-foreground">Pending</p>
        </div>
        <div className="text-center p-3 bg-green-500/10 rounded-lg">
          <p className="text-lg font-bold text-green-600">{approvedCount}</p>
          <p className="text-xs text-muted-foreground">Approved</p>
        </div>
        <div className="text-center p-3 bg-red-500/10 rounded-lg">
          <p className="text-lg font-bold text-red-600">{rejectedCount}</p>
          <p className="text-xs text-muted-foreground">Rejected</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search hyperlinks..."
            leftIcon={<Search className="w-4 h-4" />}
            onClear={() => setSearchTerm('')}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterType('all')}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg transition-colors',
              filterType === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/70'
            )}
          >
            All
          </button>
          <button
            onClick={() => setFilterType('append')}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg transition-colors',
              filterType === 'append'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/70'
            )}
          >
            Append
          </button>
          <button
            onClick={() => setFilterType('update')}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg transition-colors',
              filterType === 'update'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/70'
            )}
          >
            Update
          </button>
          <button
            onClick={() => setShowOnlyPending(!showOnlyPending)}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              showOnlyPending
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/70'
            )}
          >
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Changes List */}
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        <AnimatePresence>
          {filteredChanges.map((change, index) => {
            const isExpanded = expandedItems.has(change.id);

            return (
              <motion.div
                key={change.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ delay: index * 0.02 }}
                className={cn(
                  'border rounded-lg transition-all',
                  change.status === 'approved' && 'bg-green-500/5 border-green-500/20',
                  change.status === 'rejected' && 'bg-red-500/5 border-red-500/20',
                  change.status === 'pending' && 'hover:bg-muted/50'
                )}
              >
                <div className="p-3">
                  <div className="flex items-start gap-3">
                    {getChangeIcon(change.type)}

                    <div className="flex-1 min-w-0">
                      {/* Display Text and Status */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium truncate">{change.displayText}</span>
                        {getStatusBadge(change.status)}
                        <span className="text-xs text-muted-foreground">
                          {change.location}
                        </span>
                      </div>

                      {/* URL Changes */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">From:</span>
                          <code className="text-xs bg-muted px-1 py-0.5 rounded">
                            {truncateUrl(change.originalUrl)}
                          </code>
                        </div>

                        {change.newUrl && (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">To:</span>
                            <code className="text-xs bg-primary/10 text-primary px-1 py-0.5 rounded">
                              {truncateUrl(change.newUrl)}
                            </code>
                          </div>
                        )}

                        {change.willAppendContentId && change.contentId && (
                          <div className="flex items-center gap-2 text-sm">
                            <Hash className="w-3 h-3 text-blue-500" />
                            <span className="text-blue-600">
                              Will append: <code>{change.contentId}</code>
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Expanded Context */}
                      <AnimatePresence>
                        {isExpanded && change.context && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="mt-2 pt-2 border-t"
                          >
                            <p className="text-sm text-muted-foreground">
                              <strong>Context:</strong> {change.context}
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              {/*
                                Security: URLs are sanitized via sanitizeUrl() which validates protocols
                                and blocks javascript:, data:, vbscript:, file: and other dangerous schemes.
                                Only http:, https:, mailto:, tel:, ftp: protocols are allowed.
                                See: src/utils/urlSanitizer.ts
                              */}
                              {/* deepcode ignore XSS: URL is sanitized via sanitizeUrl() function */}
                              <a
                                href={sanitizeUrl(change.originalUrl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1"
                              >
                                View original <ExternalLink className="w-3 h-3" />
                              </a>
                              {change.newUrl && (
                                // deepcode ignore XSS: URL is sanitized via sanitizeUrl() function
                                <a
                                  href={sanitizeUrl(change.newUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary hover:underline flex items-center gap-1"
                                >
                                  View new <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleExpanded(change.id)}
                        className="p-1 hover:bg-muted rounded-md transition-colors"
                      >
                        {isExpanded ? (
                          <EyeOff className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <Eye className="w-4 h-4 text-muted-foreground" />
                        )}
                      </button>

                      {!isReadOnly && change.status === 'pending' && (
                        <>
                          <button
                            onClick={() => onApprove?.(change.id)}
                            className="p-1 hover:bg-green-500/10 rounded-md transition-colors"
                          >
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          </button>
                          <button
                            onClick={() => onReject?.(change.id)}
                            className="p-1 hover:bg-red-500/10 rounded-md transition-colors"
                          >
                            <XCircle className="w-4 h-4 text-red-500" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {filteredChanges.length === 0 && (
          <div className="text-center py-8">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No changes found</p>
          </div>
        )}
      </div>

      {/* Apply Button */}
      {!isReadOnly && approvedCount > 0 && (
        <div className="flex justify-end">
          <Button
            onClick={onApply}
            className="min-w-[120px]"
          >
            Apply {approvedCount} Change{approvedCount !== 1 ? 's' : ''}
          </Button>
        </div>
      )}
    </div>
  );
}