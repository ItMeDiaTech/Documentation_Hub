import { useState, useCallback } from "react";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive" | "success";
  duration?: number;
}

// Default duration: 3 seconds for quick, unobtrusive notifications
// Error notifications get longer (6 seconds) so a screen reader has time to
// announce the title plus a potentially long description before dismissal
const DEFAULT_DURATION = 5000;
const ERROR_DURATION = 6000;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback(
    ({ title, description, variant = "default", duration }: Omit<Toast, "id">) => {
      // Use provided duration, or default based on variant
      const effectiveDuration =
        duration ?? (variant === "destructive" ? ERROR_DURATION : DEFAULT_DURATION);

      const id = Math.random().toString(36).substring(7);
      const newToast: Toast = { id, title, description, variant, duration: effectiveDuration };

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
