import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles } from "lucide-react";
import { cn } from "@/utils/cn";
import type { ChangelogEntry } from "@/data/changelog";
import { formatVersionLabel } from "@/utils/whatsNew";

interface WhatsNewModalProps {
  open: boolean;
  /** Called for every dismissal path: X button, Dismiss button, Escape, backdrop. */
  onClose: () => void;
  /** The version currently running, shown in the title. */
  version: string;
  /** Changelog entries to list, newest first. */
  entries: ChangelogEntry[];
}

export function WhatsNewModal({ open, onClose, version, entries }: WhatsNewModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: "spring", duration: 0.3 }}
                className={cn(
                  "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
                  "w-full max-w-2xl max-h-[85vh] overflow-hidden",
                  "bg-background rounded-xl border border-border shadow-2xl",
                  "flex flex-col"
                )}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Sparkles className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <Dialog.Title className="text-lg font-semibold">
                        What&apos;s New in {formatVersionLabel(version)}
                      </Dialog.Title>
                      <Dialog.Description className="text-sm text-muted-foreground">
                        A quick look at recent improvements
                      </Dialog.Description>
                    </div>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      className="p-2 rounded-lg hover:bg-muted transition-colors"
                      aria-label="Close"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </Dialog.Close>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="space-y-6">
                    {entries.map((entry) => (
                      <div key={entry.version}>
                        <div className="flex items-baseline gap-3 flex-wrap">
                          <h3 className="text-base font-semibold">
                            {formatVersionLabel(entry.version)}
                          </h3>
                          <span className="text-xs text-muted-foreground">{entry.date}</span>
                        </div>

                        {entry.areas.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {entry.areas.map((area) => (
                              <span
                                key={area}
                                className="px-2 py-0.5 text-xs font-medium rounded-full bg-primary/10 text-primary"
                              >
                                {area}
                              </span>
                            ))}
                          </div>
                        )}

                        <ul className="mt-3 space-y-1.5">
                          {entry.highlights.map((highlight, index) => (
                            <li
                              key={index}
                              className="flex gap-2 text-sm text-muted-foreground leading-relaxed"
                            >
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                              <span>{highlight}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-border bg-muted/30">
                  <p className="text-xs text-muted-foreground">
                    You can turn this off in Settings → Updates.
                  </p>
                  <button
                    onClick={onClose}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-medium",
                      "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    )}
                  >
                    Dismiss
                  </button>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
