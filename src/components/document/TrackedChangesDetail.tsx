import type { DocumentChange } from '@/types/session';
import { cn } from '@/utils/cn';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Hash,
  Link,
  List,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';

interface TrackedChangesDetailProps {
  changes: DocumentChange[];
  className?: string;
}

interface GroupedChange {
  category: string;
  title: string;
  icon: typeof Link;
  iconColor: string;
  items: DocumentChange[];
  summary?: string;
}

export function TrackedChangesDetail({ changes, className }: TrackedChangesDetailProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Group changes by category with intelligent aggregation
  const groupedChanges = groupChangesByCategory(changes);

  if (groupedChanges.length === 0) {
    return (
      <div className={cn('text-center py-4 text-sm text-muted-foreground', className)}>
        No tracked changes to display
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-sm">Tracked Changes ({changes.length})</h4>
        <button
          onClick={() => {
            if (expandedCategories.size === groupedChanges.length) {
              setExpandedCategories(new Set());
            } else {
              setExpandedCategories(new Set(groupedChanges.map((g) => g.category)));
            }
          }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {expandedCategories.size === groupedChanges.length ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      <div className="space-y-2">
        {groupedChanges.map((group) => (
          <ChangeGroup
            key={group.category}
            group={group}
            isExpanded={expandedCategories.has(group.category)}
            onToggle={() => toggleCategory(group.category)}
          />
        ))}
      </div>
    </div>
  );
}

function ChangeGroup({
  group,
  isExpanded,
  onToggle,
}: {
  group: GroupedChange;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const Icon = group.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-border rounded-lg overflow-hidden bg-muted/20"
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors text-left"
      >
        <Icon className={cn('w-5 h-5 shrink-0', group.iconColor)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{group.title}</span>
            <span className="text-xs text-muted-foreground">({group.items.length})</span>
          </div>
          {group.summary && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{group.summary}</p>
          )}
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {isExpanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="border-t border-border"
        >
          {group.category === 'hyperlink_update' ? (
            <HyperlinkUpdatesView items={group.items} />
          ) : group.category === 'hyperlink_failed' ? (
            <HyperlinkFailedView items={group.items} />
          ) : group.category === 'list_fix' ? (
            <ListFixesView items={group.items} />
          ) : group.category === 'blank_lines' ? (
            <BlankLinesView items={group.items} />
          ) : (
            <DefaultChangesView items={group.items} />
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

function HyperlinkUpdatesView({ items }: { items: DocumentChange[] }) {
  // Group by Header 2
  const byHeader2 = groupByHeader2(items);

  return (
    <div className="p-3 space-y-4 max-h-96 overflow-y-auto">
      {byHeader2.map((section, idx) => (
        <div key={idx} className="space-y-2">
          {section.header && (
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <FileText className="w-3 h-3" />
              <span>Under "{section.header}"</span>
            </div>
          )}
          <div className="space-y-2 pl-5">
            {section.items.map((change, itemIdx) => (
              <div key={itemIdx} className="space-y-1 text-xs">
                <div className="flex items-start gap-2">
                  <span className="font-medium text-foreground">
                    {change.description}
                  </span>
                  {change.contentId && (
                    <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px]">
                      {change.contentId}
                    </code>
                  )}
                </div>
                {change.before && (
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground min-w-[45px]">Before:</span>
                    <code className="bg-muted px-1.5 py-0.5 rounded break-all flex-1">
                      {change.before}
                    </code>
                  </div>
                )}
                {change.after && (
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground min-w-[45px]">After:</span>
                    <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded break-all flex-1">
                      {change.after}
                    </code>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HyperlinkFailedView({ items }: { items: DocumentChange[] }) {
  const byHeader2 = groupByHeader2(items);

  return (
    <div className="p-3 space-y-4 max-h-96 overflow-y-auto">
      {byHeader2.map((section, idx) => (
        <div key={idx} className="space-y-2">
          {section.header && (
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <FileText className="w-3 h-3" />
              <span>Under "{section.header}"</span>
            </div>
          )}
          <div className="space-y-1.5 pl-5">
            {section.items.map((change, itemIdx) => (
              <div key={itemIdx} className="flex items-start gap-2 text-xs">
                {change.hyperlinkStatus === 'expired' ? (
                  <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <span className="font-medium">{change.description}</span>
                  {change.contentId && (
                    <span className="ml-2 text-muted-foreground">({change.contentId})</span>
                  )}
                  <span
                    className={cn(
                      'ml-2 text-[10px] px-1.5 py-0.5 rounded',
                      change.hyperlinkStatus === 'expired'
                        ? 'bg-orange-500/10 text-orange-600'
                        : 'bg-red-500/10 text-red-600'
                    )}
                  >
                    {change.hyperlinkStatus === 'expired' ? 'Expired' : 'Not Found'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ListFixesView({ items }: { items: DocumentChange[] }) {
  const byHeader2 = groupByHeader2(items);

  return (
    <div className="p-3 space-y-4 max-h-96 overflow-y-auto">
      {byHeader2.map((section, idx) => (
        <div key={idx} className="space-y-2">
          {section.header && (
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <FileText className="w-3 h-3" />
              <span>Under "{section.header}"</span>
            </div>
          )}
          <div className="space-y-1 pl-5">
            {section.items.map((change, itemIdx) => (
              <div key={itemIdx} className="flex items-start gap-2 text-xs">
                <CheckCircle className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                <span>{change.description}</span>
                {change.count !== undefined && change.count > 0 && (
                  <span className="text-muted-foreground">({change.count} items)</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BlankLinesView({ items }: { items: DocumentChange[] }) {
  // Aggregate blank line changes
  const removed = items.filter((c) => c.description.toLowerCase().includes('removed'));
  const added = items.filter((c) => c.description.toLowerCase().includes('added'));

  const totalRemoved = removed.reduce((sum, c) => sum + (c.count || 1), 0);
  const totalAdded = added.reduce((sum, c) => sum + (c.count || 1), 0);

  return (
    <div className="p-3 space-y-2 text-xs">
      {totalRemoved > 0 && (
        <div className="flex items-center gap-2">
          <XCircle className="w-4 h-4 text-red-500" />
          <span>Removed {totalRemoved} blank line{totalRemoved !== 1 ? 's' : ''}</span>
        </div>
      )}
      {totalAdded > 0 && (
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <span>
            Added {totalAdded} standardized line{totalAdded !== 1 ? 's' : ''} for structure
          </span>
        </div>
      )}
    </div>
  );
}

function DefaultChangesView({ items }: { items: DocumentChange[] }) {
  return (
    <div className="p-3 space-y-1.5 max-h-96 overflow-y-auto">
      {items.map((change, idx) => (
        <div key={idx} className="flex items-start gap-2 text-xs">
          <CheckCircle className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">{change.description}</p>
            {change.nearestHeader2 && (
              <p className="text-muted-foreground text-[10px] mt-0.5">
                Under "{change.nearestHeader2}"
              </p>
            )}
            {change.before && change.after && (
              <div className="mt-1 space-y-0.5">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground min-w-[45px]">Before:</span>
                  <code className="bg-muted px-1.5 py-0.5 rounded break-all flex-1">
                    {change.before}
                  </code>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground min-w-[45px]">After:</span>
                  <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded break-all flex-1">
                    {change.after}
                  </code>
                </div>
              </div>
            )}
            {change.count !== undefined && change.count > 0 && (
              <p className="text-muted-foreground text-[10px] mt-0.5">
                {change.count} occurrence{change.count !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Helper: Group changes by category
function groupChangesByCategory(changes: DocumentChange[]): GroupedChange[] {
  const groups: GroupedChange[] = [];

  // Separate changes by category
  const hyperlinksUpdated = changes.filter(
    (c) => c.category === 'hyperlink_update' && c.hyperlinkStatus === 'updated'
  );
  const hyperlinksFailed = changes.filter(
    (c) =>
      c.category === 'hyperlink_failed' ||
      c.hyperlinkStatus === 'expired' ||
      c.hyperlinkStatus === 'not_found'
  );
  const listFixes = changes.filter((c) => c.category === 'list_fix');
  const blankLines = changes.filter((c) => c.category === 'blank_lines');
  const styleChanges = changes.filter((c) => c.category === 'style_application');
  const structureChanges = changes.filter((c) => c.category === 'structure');
  const otherChanges = changes.filter(
    (c) =>
      !c.category ||
      (c.category === 'other' &&
        !hyperlinksUpdated.includes(c) &&
        !hyperlinksFailed.includes(c) &&
        !listFixes.includes(c) &&
        !blankLines.includes(c) &&
        !styleChanges.includes(c) &&
        !structureChanges.includes(c))
  );

  // Hyperlink updates
  if (hyperlinksUpdated.length > 0) {
    groups.push({
      category: 'hyperlink_update',
      title: 'Updated Hyperlink URLs / Content IDs',
      icon: Link,
      iconColor: 'text-blue-500',
      items: hyperlinksUpdated,
      summary: `${hyperlinksUpdated.length} hyperlink${hyperlinksUpdated.length !== 1 ? 's' : ''} updated`,
    });
  }

  // Failed/Expired hyperlinks
  if (hyperlinksFailed.length > 0) {
    const expiredCount = hyperlinksFailed.filter((c) => c.hyperlinkStatus === 'expired').length;
    const notFoundCount = hyperlinksFailed.filter(
      (c) => c.hyperlinkStatus === 'not_found'
    ).length;

    let summary = '';
    if (expiredCount > 0 && notFoundCount > 0) {
      summary = `${expiredCount} expired, ${notFoundCount} not found`;
    } else if (expiredCount > 0) {
      summary = `${expiredCount} expired`;
    } else {
      summary = `${notFoundCount} not found`;
    }

    groups.push({
      category: 'hyperlink_failed',
      title: 'Hyperlink Issues Found',
      icon: AlertTriangle,
      iconColor: 'text-orange-500',
      items: hyperlinksFailed,
      summary,
    });
  }

  // List formatting fixes
  if (listFixes.length > 0) {
    const totalListsFixed = listFixes.reduce((sum, c) => sum + (c.count || 1), 0);
    groups.push({
      category: 'list_fix',
      title: 'List Formatting',
      icon: List,
      iconColor: 'text-purple-500',
      items: listFixes,
      summary: `Fixed ${totalListsFixed} list${totalListsFixed !== 1 ? 's' : ''}`,
    });
  }

  // Blank lines (condensed)
  if (blankLines.length > 0) {
    groups.push({
      category: 'blank_lines',
      title: 'Structure Changes',
      icon: FileText,
      iconColor: 'text-gray-500',
      items: blankLines,
      summary: 'Blank line adjustments',
    });
  }

  // Style applications
  if (styleChanges.length > 0) {
    groups.push({
      category: 'style_application',
      title: 'Style Applications',
      icon: Hash,
      iconColor: 'text-indigo-500',
      items: styleChanges,
      summary: `${styleChanges.length} style${styleChanges.length !== 1 ? 's' : ''} applied`,
    });
  }

  // Other structure changes
  if (structureChanges.length > 0) {
    groups.push({
      category: 'structure',
      title: 'Other Structure Changes',
      icon: FileText,
      iconColor: 'text-teal-500',
      items: structureChanges,
      summary: `${structureChanges.length} change${structureChanges.length !== 1 ? 's' : ''}`,
    });
  }

  // Other changes
  if (otherChanges.length > 0) {
    groups.push({
      category: 'other',
      title: 'Other Changes',
      icon: FileText,
      iconColor: 'text-gray-500',
      items: otherChanges,
      summary: `${otherChanges.length} miscellaneous change${otherChanges.length !== 1 ? 's' : ''}`,
    });
  }

  return groups;
}

// Helper: Group items by nearest Header 2
function groupByHeader2(
  items: DocumentChange[]
): Array<{ header: string | null; items: DocumentChange[] }> {
  const grouped = new Map<string | null, DocumentChange[]>();

  for (const item of items) {
    const header = item.nearestHeader2 || null;
    if (!grouped.has(header)) {
      grouped.set(header, []);
    }
    grouped.get(header)!.push(item);
  }

  // Convert to array, sort by header (nulls last)
  return Array.from(grouped.entries())
    .sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a.localeCompare(b);
    })
    .map(([header, items]) => ({ header, items }));
}
