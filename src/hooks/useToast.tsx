import { useState, useCallback } from "react";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive" | "success";
  duration?: number;
  // When set, the toast body becomes clickable and invokes this on click
  // (e.g. open a details dialog). Optional, so existing toasts are unaffected.
  onClick?: () => void;
}

// Default duration: 5 seconds for quick, unobtrusive notifications.
// Error notifications get longer (6 seconds) so a screen reader has time to
// announce the title plus a potentially long description before dismissal.
const DEFAULT_DURATION = 5000;
const ERROR_DURATION = 6000;

// Unique, non-empty id. crypto.randomUUID is available in the Electron
// renderer; fall back to a timestamped counter for safety.
let toastCounter = 0;
function generateToastId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  toastCounter += 1;
  return `toast-${Date.now()}-${toastCounter}`;
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback(
    ({ title, description, variant = "default", duration, onClick }: Omit<Toast, "id">) => {
      // Use provided duration, or default based on variant
      const effectiveDuration =
        duration ?? (variant === "destructive" ? ERROR_DURATION : DEFAULT_DURATION);

      const id = generateToastId();
      const newToast: Toast = {
        id,
        title,
        description,
        variant,
        duration: effectiveDuration,
        onClick,
      };

      setToasts((prev) => [...prev, newToast]);

      // Auto-remove toast after duration
      if (effectiveDuration > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, effectiveDuration);
      }

      return id;
    },
    []
  );

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  return {
    toasts,
    toast,
    dismiss,
    dismissAll,
  };
}
