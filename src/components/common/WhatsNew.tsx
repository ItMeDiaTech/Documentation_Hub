import { useCallback, useEffect, useRef, useState } from "react";
import { useUserSettings } from "@/contexts/UserSettingsContext";
import { CHANGELOG } from "@/data/changelog";
import {
  WHATS_NEW_STORAGE_KEY,
  getChangelogEntry,
  shouldShowWhatsNew,
} from "@/utils/whatsNew";
import { WhatsNewModal } from "./WhatsNewModal";

/**
 * Gate that shows the "What's New" popup once on the first launch after the app
 * updates to a new version. Decides a single time per app session (once the
 * settings and running version are known) so toggling the setting or dismissing
 * the popup never re-triggers it. Dismissal stores the running version so the
 * same version won't show it again.
 */
export function WhatsNew() {
  const { settings, isLoading } = useUserSettings();
  const [version, setVersion] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const decidedRef = useRef(false);

  // Resolve the running app version (Electron only; browser/dev mode has none).
  useEffect(() => {
    if (typeof window.electronAPI === "undefined") return;
    let cancelled = false;
    window.electronAPI
      .getAppVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        /* version stays null -> popup stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Decide once, after settings have loaded and the version is known.
  useEffect(() => {
    if (decidedRef.current) return;
    if (isLoading || !version) return;
    decidedRef.current = true;

    const lastSeenVersion = localStorage.getItem(WHATS_NEW_STORAGE_KEY);
    const show = shouldShowWhatsNew({
      enabled: settings.updateSettings.showWhatsNewAfterUpdate,
      currentVersion: version,
      lastSeenVersion,
      hasEntry: Boolean(getChangelogEntry(version)),
    });
    if (show) setOpen(true);
  }, [isLoading, version, settings.updateSettings.showWhatsNewAfterUpdate]);

  const handleClose = useCallback(() => {
    setOpen(false);
    if (version) {
      try {
        localStorage.setItem(WHATS_NEW_STORAGE_KEY, version);
      } catch {
        /* if persistence fails the popup may reappear next launch; acceptable */
      }
    }
  }, [version]);

  if (!version) return null;

  return (
    <WhatsNewModal open={open} onClose={handleClose} version={version} entries={CHANGELOG} />
  );
}
