/**
 * ComparisonWindow - Displays before/after document processing changes
 *
 * This component shows a detailed comparison of what changed during
 * document processing in a separate Electron window.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  Link,
  Type,
  Palette,
  Activity,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle,
  AlertCircle,
  X,
} from 'lucide-react';
import {
  ProcessingComparison,
  HyperlinkChange,
  StyleChange,
} from '@/services/document/DocumentProcessingComparison';
import { cn } from '@/utils/cn';

interface ComparisonWindowProps {
  comparison: ProcessingComparison;
  onClose?: () => void;
}

export const ComparisonWindow: React.FC<ComparisonWindowProps> = ({ comparison, onClose }) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['hyperlinks']));
  const [filter, setFilter] = useState<'all' | 'urls' | 'texts' | 'styles'>('all');

  // Toggle section expansion
  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Calculate processing time
  const processingTime = comparison.statistics.processingDurationMs;
  const formattedTime =
    processingTime < 1000
      ? `${processingTime.toFixed(0)}ms`
      : `${(processingTime / 1000).toFixed(2)}s`;

  // Filter changes based on selected filter
  const filteredHyperlinkChanges = comparison.hyperlinkChanges.filter((change) => {
    if (filter === 'all') return true;
    if (filter === 'urls') return change.originalUrl !== change.modifiedUrl;
    if (filter === 'texts') return change.originalText !== change.modifiedText;
    return false;
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-6 h-6 text-blue-500" />
              <div>
                <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Document Processing Comparison
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {comparison.documentPath.split('/').pop()}
                </p>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                aria-label="Close comparison window"
              >
                <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            )}
          </div>

          {/* Statistics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
            <StatCard
              icon={<Activity className="w-4 h-4" />}
              label="Total Changes"
              value={comparison.statistics.totalChanges}
              color="blue"
            />
            <StatCard
              icon={<Link className="w-4 h-4" />}
              label="URLs Modified"
              value={comparison.statistics.urlsChanged}
              color="purple"
            />
            <StatCard
              icon={<Type className="w-4 h-4" />}
              label="Texts Updated"
              value={comparison.statistics.displayTextsChanged}
              color="green"
            />
            <StatCard
              icon={<Palette className="w-4 h-4" />}
              label="Styles Applied"
              value={comparison.statistics.stylesApplied}
              color="orange"
            />
            <StatCard
              icon={<CheckCircle className="w-4 h-4" />}
              label="Content IDs"
              value={comparison.statistics.contentIdsAppended}
              color="teal"
            />
            <StatCard
              icon={<Clock className="w-4 h-4" />}
              label="Processing Time"
              value={formattedTime}
              color="gray"
            />
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-2 mt-4">
            {(['all', 'urls', 'texts', 'styles'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  filter === tab
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                )}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'all' && ` (${comparison.statistics.totalChanges})`}
                {tab === 'urls' && ` (${comparison.statistics.urlsChanged})`}
                {tab === 'texts' && ` (${comparison.statistics.displayTextsChanged})`}
                {tab === 'styles' && ` (${comparison.statistics.stylesApplied})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Hyperlink Changes Section */}
        {(filter === 'all' || filter === 'urls' || filter === 'texts') &&
          filteredHyperlinkChanges.length > 0 && (
            <Section
              title="Hyperlink Changes"
              icon={<Link className="w-5 h-5" />}
              count={filteredHyperlinkChanges.length}
              expanded={expandedSections.has('hyperlinks')}
              onToggle={() => toggleSection('hyperlinks')}
            >
              <div className="space-y-3">
                {filteredHyperlinkChanges.map((change, index) => (
                  <HyperlinkChangeCard key={index} change={change} />
                ))}
              </div>
            </Section>
          )}

        {/* Style Changes Section */}
        {(filter === 'all' || filter === 'styles') && comparison.styleChanges.length > 0 && (
          <Section
            title="Style Changes"
            icon={<Palette className="w-5 h-5" />}
            count={comparison.styleChanges.length}
            expanded={expandedSections.has('styles')}
            onToggle={() => toggleSection('styles')}
          >
            <div className="space-y-3">
              {comparison.styleChanges.map((change, index) => (
                <StyleChangeCard key={index} change={change} />
              ))}
            </div>
          </Section>
        )}

        {/* Empty State */}
        {filteredHyperlinkChanges.length === 0 &&
          (filter === 'styles' ? comparison.styleChanges.length === 0 : true) && (
            <div className="text-center py-12">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400">
                No changes found for the selected filter
              </p>
            </div>
          )}
      </div>
    </div>
  );
};

// Stat Card Component
const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: 'blue' | 'purple' | 'green' | 'orange' | 'teal' | 'gray';
}> = ({ icon, label, value, color }) => {
  const colorClasses = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    orange: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400',
    teal: 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400',
    gray: 'bg-gray-50 dark:bg-gray-900/20 text-gray-600 dark:text-gray-400',
  };

  return (
    <div className={cn('p-3 rounded-lg', colorClasses[color])}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-medium opacity-80">{label}</span>
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
};

// Section Component
const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, icon, count, expanded, onToggle, children }) => {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
      <button
        onClick={onToggle}
        className="w-full bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow"
      >
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {icon}
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
            <span className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm rounded-full">
              {count}
            </span>
          </div>
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// Hyperlink Change Card
const HyperlinkChangeCard: React.FC<{ change: HyperlinkChange }> = ({ change }) => {
  const urlChanged = change.originalUrl !== change.modifiedUrl;
  const textChanged = change.originalText !== change.modifiedText;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Paragraph {change.paragraphIndex + 1}, Hyperlink {change.hyperlinkIndex + 1}
        </div>
        <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded">
          {change.changeReason}
        </div>
      </div>

      {urlChanged && (
        <div className="mb-3">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            URL Changed:
          </div>
          <div className="space-y-1">
            <div className="flex items-start gap-2">
              <span className="text-red-500">−</span>
              <code className="text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-1.5 rounded flex-1 break-all">
                {change.originalUrl}
              </code>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-green-500">+</span>
              <code className="text-xs bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 p-1.5 rounded flex-1 break-all">
                {change.modifiedUrl}
              </code>
            </div>
          </div>
        </div>
      )}

      {textChanged && (
        <div>
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            Display Text Changed:
          </div>
          <div className="space-y-1">
            <div className="flex items-start gap-2">
              <span className="text-red-500">−</span>
              <div className="text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-1.5 rounded flex-1">
                {change.originalText}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-green-500">+</span>
              <div className="text-sm bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 p-1.5 rounded flex-1">
                {change.modifiedText}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Style Change Card
const StyleChangeCard: React.FC<{ change: StyleChange }> = ({ change }) => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Paragraph {change.paragraphIndex + 1}
        </div>
        <div className="text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-2 py-1 rounded">
          {change.styleName}
        </div>
      </div>

      <div className="space-y-1">
        {Object.entries(change.properties).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2 text-sm">
            <span className="text-gray-500 dark:text-gray-400">{key}:</span>
            <span className="text-gray-900 dark:text-white font-medium">{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ComparisonWindow;
