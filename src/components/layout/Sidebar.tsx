import { useState, useEffect, useRef, memo, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home,
  FolderOpen,
  Settings,
  ChevronRight,
  BarChart3,
  FileText,
  X,
  Circle,
  Keyboard,
  Mail,
  MessageSquare,
  FolderKanban,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useNavigate, useLocation } from "react-router-dom";
import { useSession } from "@/contexts/SessionContext";
import { useUserSettings } from "@/contexts/UserSettingsContext";
import { SimpleTooltip } from "@/components/common/Tooltip";
import { Toaster } from "@/components/common/Toast";
import { useToast } from "@/hooks/useToast";
import { isOpenableExternalUrl, normalizeExternalUrl } from "@/utils/urlHelpers";
import iconPng from "/icon.png";

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  path: string;
  badge?: number;
  indented?: boolean;
  closeable?: boolean;
  onClose?: () => void;
  shortcut?: string;
  // When set, overrides default path navigation (e.g. open an external link).
  onSelect?: () => void;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

export const Sidebar = memo(function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [logoClickCount, setLogoClickCount] = useState(0);
  const [appVersion, setAppVersion] = useState<string>("");
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { sessions, activeSessions, closeSession } = useSession();
  const { settings } = useUserSettings();
  const { toasts, toast, dismiss } = useToast();

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setAppVersion).catch(() => setAppVersion(""));
  }, []);

  // Reset click count after 2 seconds of inactivity
  useEffect(() => {
    if (logoClickCount > 0) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
      clickTimerRef.current = setTimeout(() => {
        setLogoClickCount(0);
      }, 2000);
    }
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
    };
  }, [logoClickCount]);

  // Ctrl+Q to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "q") {
        e.preventDefault();
        setCollapsed((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleLogoClick = useCallback(() => {
    const newCount = logoClickCount + 1;
    setLogoClickCount(newCount);

    if (newCount === 5) {
      // Easter egg: open dev tools!
      window.electronAPI.openDevTools();
      setLogoClickCount(0);
    }
  }, [logoClickCount]);

  const handleNavClick = useCallback(
    (path: string) => {
      navigate(path);
    },
    [navigate]
  );

  // Open a saved quick link externally. The URL is normalized first (auto-fix
  // for a missing scheme); a failure surfaces a toast instead of failing
  // silently with an uncaught promise rejection.
  const openQuickLink = useCallback(
    (rawUrl: string) => {
      const url = normalizeExternalUrl(rawUrl);
      const failed = () =>
        toast({
          title: "Couldn't open link",
          description: rawUrl,
          variant: "destructive",
        });
      // Reject disallowed schemes here too — the main-process handler is the
      // real trust boundary, but this avoids a needless IPC round-trip and
      // surfaces the failure consistently.
      if (!isOpenableExternalUrl(url)) {
        failed();
        return;
      }
      window.electronAPI.openExternal(url).catch(failed);
    },
    [toast]
  );

  // Build navigation sections with dynamic sessions
  const navSections = useMemo(() => {
    const sections: NavSection[] = [];

    // Main navigation section
    const mainItems: NavItem[] = [
      { id: "home", label: "Dashboard", icon: Home, path: "/", shortcut: "Ctrl+1" },
    ];

    // Add active sessions under Dashboard
    activeSessions.forEach((session) => {
      mainItems.push({
        id: `session-${session.id}`,
        label: session.name,
        icon: Circle,
        path: `/session/${session.id}`,
        indented: true,
        closeable: true,
        onClose: () => closeSession(session.id),
      });
    });

    sections.push({ items: mainItems });

    // Workspace section
    sections.push({
      title: "Workspace",
      items: [
        {
          id: "sessions",
          label: "Sessions",
          icon: FolderOpen,
          path: "/sessions",
          shortcut: "Ctrl+2",
        },
        {
          id: "analytics",
          label: "Analytics",
          icon: BarChart3,
          path: "/analytics",
          shortcut: "Ctrl+3",
        },
        {
          id: "documents",
          label: "Documents",
          icon: FileText,
          path: "/documents",
          shortcut: "Ctrl+4",
        },
        { id: "reporting", label: "Reporting", icon: Mail, path: "/reporting", shortcut: "Ctrl+5" },
      ],
    });

    // Quick Links section: Feedback and Document Managers, each with one
    // indented sub-item per saved link. Clicking a parent opens the matching
    // Settings section; clicking a sub-item opens that link externally.
    const quickLinkItems: NavItem[] = [];

    quickLinkItems.push({
      id: "feedback",
      label: "Nuxeo Feedback",
      icon: MessageSquare,
      path: "/settings",
      onSelect: () => navigate("/settings?section=feedback"),
    });
    settings.feedbackLinks.forEach((link) => {
      quickLinkItems.push({
        id: `feedback-link-${link.id}`,
        label: link.name || link.url,
        icon: Circle,
        path: "/settings",
        indented: true,
        onSelect: () => openQuickLink(link.url),
      });
    });

    quickLinkItems.push({
      id: "document-managers",
      label: "Document Managers",
      icon: FolderKanban,
      path: "/settings",
      onSelect: () => navigate("/settings?section=documentManagers"),
    });
    settings.documentManagerLinks.forEach((link) => {
      quickLinkItems.push({
        id: `document-manager-link-${link.id}`,
        label: link.name || link.url,
        icon: Circle,
        path: "/settings",
        indented: true,
        onSelect: () => openQuickLink(link.url),
      });
    });

    sections.push({ title: "Quick Links", items: quickLinkItems });

    return sections;
  }, [
    activeSessions,
    closeSession,
    settings.feedbackLinks,
    settings.documentManagerLinks,
    navigate,
    openQuickLink,
  ]);

  const bottomItems = useMemo<NavItem[]>(
    () => [
      { id: "settings", label: "Settings", icon: Settings, path: "/settings", shortcut: "Ctrl+," },
    ],
    []
  );

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    // Items with an onSelect override (external links, query-param nav) are
    // actions rather than routes, so they never take the route-active style.
    const isActive = !item.onSelect && location.pathname === item.path;

    const buttonElement = (
      <div
        className={cn(
          "relative group",
          item.indented && !collapsed && "ml-4",
          item.indented && collapsed && "ml-0"
        )}
      >
        <button
          type="button"
          onClick={() => (item.onSelect ? item.onSelect() : handleNavClick(item.path))}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isActive && "bg-primary text-primary-foreground hover:bg-primary/90",
            collapsed && "justify-center"
          )}
        >
          <div className="flex items-center gap-3 flex-1 pointer-events-none">
            {item.indented && !collapsed && (
              <div className="w-4 h-4 flex items-center justify-center">
                <Circle className="w-2 h-2" />
              </div>
            )}
            {(!item.indented || collapsed) && (
              <Icon className={cn("w-4 h-4 flex-shrink-0", collapsed && "w-5 h-5")} />
            )}
            <AnimatePresence mode="wait">
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-sm font-medium whitespace-nowrap overflow-hidden flex-1 text-left"
                >
                  {item.label}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          {item.closeable && !collapsed && (
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                item.onClose?.();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  item.onClose?.();
                }
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-background/20 pointer-events-none group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="w-3 h-3" />
            </div>
          )}
          {item.badge && !collapsed && (
            <span className="ml-auto px-1.5 py-0.5 text-xs bg-destructive text-destructive-foreground rounded-full">
              {item.badge}
            </span>
          )}
          {item.badge && collapsed && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" />
          )}
        </button>
      </div>
    );

    // Wrap with tooltip when collapsed (for non-indented items)
    if (collapsed && !item.indented) {
      return (
        <SimpleTooltip key={item.id} content={item.label} side="right">
          {buttonElement}
        </SimpleTooltip>
      );
    }

    return <div key={item.id}>{buttonElement}</div>;
  };

  return (
    <motion.aside
      initial={{ width: 240 }}
      animate={{ width: collapsed ? 64 : 240 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="sidebar-bg h-full bg-background/50 backdrop-blur-xl border-r border-border flex flex-col relative"
    >
      <div className="p-4 flex items-center justify-between">
        <AnimatePresence mode="wait">
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2"
            >
              <motion.div
                onClick={handleLogoClick}
                whileTap={{ scale: 0.9 }}
                className="w-8 h-8 rounded-lg cursor-pointer hover:opacity-90 transition-opacity overflow-hidden"
              >
                <img src={iconPng} alt="DocHub" className="w-full h-full" />
              </motion.div>
              <span className="font-semibold text-sm">DocHub</span>
              {appVersion && (
                <span className="text-xs text-muted-foreground font-normal leading-none">
                  v{appVersion}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {collapsed && (
          <motion.div
            onClick={handleLogoClick}
            whileTap={{ scale: 0.9 }}
            className="w-8 h-8 rounded-lg cursor-pointer hover:opacity-90 transition-opacity overflow-hidden"
          >
            <img src={iconPng} alt="DocHub" className="w-full h-full" />
          </motion.div>
        )}
      </div>

      <div className="mx-4 mb-3 h-px bg-border" />

      <nav className="flex-1 px-3 pb-3 overflow-y-auto">
        <div className="space-y-4">
          {navSections.map((section, sectionIndex) => (
            <div key={section.title || sectionIndex}>
              {section.title && !collapsed && (
                <div className="px-3 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {section.title}
                  </span>
                </div>
              )}
              {section.title && collapsed && <div className="mx-auto my-2 w-6 h-px bg-border" />}
              <div className="space-y-1">{section.items.map(renderNavItem)}</div>
            </div>
          ))}
        </div>
      </nav>

      <div className="px-3 pb-3 space-y-1 border-t border-border pt-3">
        {bottomItems.map(renderNavItem)}
      </div>

      <SimpleTooltip
        content={collapsed ? "Expand sidebar (Ctrl+Q)" : "Collapse sidebar (Ctrl+Q)"}
        side="right"
      >
        <motion.button
          onClick={() => setCollapsed(!collapsed)}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className={cn(
            "absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full",
            "bg-background border-2 border-border",
            "hover:border-primary hover:shadow-lg transition-all",
            "flex items-center justify-center",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "group"
          )}
        >
          <motion.div animate={{ rotate: collapsed ? 0 : 180 }} transition={{ duration: 0.3 }}>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </motion.div>
        </motion.button>
      </SimpleTooltip>

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </motion.aside>
  );
});
