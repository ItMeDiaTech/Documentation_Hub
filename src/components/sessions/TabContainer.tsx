import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';

interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface TabContainerProps {
  tabs: Tab[];
  defaultTab?: string;
  className?: string;
  headerActions?: Record<string, React.ReactNode>; // Action buttons per tab ID
}

export function TabContainer({ tabs, defaultTab, className, headerActions }: TabContainerProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const activeTabData = tabs.find((tab) => tab.id === activeTab);

  // Check for overflow and update arrow visibility
  useEffect(() => {
    const container = tabsRef.current;
    if (!container) return;

    const checkScroll = () => {
      const { scrollLeft, scrollWidth, clientWidth } = container;
      setShowLeftArrow(scrollLeft > 0);
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 1);
    };

    checkScroll();
    container.addEventListener('scroll', checkScroll);
    window.addEventListener('resize', checkScroll);

    return () => {
      container.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [tabs]);

  const scrollLeft = () => {
    tabsRef.current?.scrollBy({ left: -200, behavior: 'smooth' });
  };

  const scrollRight = () => {
    tabsRef.current?.scrollBy({ left: 200, behavior: 'smooth' });
  };

  return (
    <div className={cn('w-full', className)}>
      {/* Tab Navigation - Sticky */}
      <div className="sticky top-0 bg-background z-20 flex items-center border-b border-border">
        {/* Left Scroll Button */}
        {showLeftArrow && (
          <button
            onClick={scrollLeft}
            className="flex-shrink-0 px-2 py-2.5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Scroll tabs left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}

        {/* Scrollable Tabs Container */}
        <div
          ref={tabsRef}
          className="flex gap-1 px-4 overflow-x-auto flex-1"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative px-4 py-2.5 text-sm font-medium transition-all whitespace-nowrap',
                'hover:text-foreground',
                activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                  initial={false}
                  transition={{
                    type: 'spring',
                    stiffness: 500,
                    damping: 30,
                  }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Right Scroll Button */}
        {showRightArrow && (
          <button
            onClick={scrollRight}
            className="flex-shrink-0 px-2 py-2.5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Scroll tabs right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {/* Header Actions for Active Tab */}
        {headerActions?.[activeTab] && (
          <div className="flex-shrink-0 px-4 py-2 border-l border-border">
            {headerActions[activeTab]}
          </div>
        )}
      </div>

      {/* Tab Content */}
      <div className="p-4">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {activeTabData?.content}
        </motion.div>
      </div>
    </div>
  );
}
