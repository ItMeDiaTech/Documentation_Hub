import * as React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Toast as ToastType } from '@/hooks/useToast';

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      'fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col gap-1 p-2 sm:max-w-72',
      className
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & {
    variant?: 'default' | 'destructive' | 'success';
  }
>(({ className, variant = 'default', ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(
        'group pointer-events-auto relative flex w-full items-center gap-2 overflow-hidden rounded-md border py-2 px-3 shadow-sm transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-bottom-full',
        variant === 'default' && 'border-border/50 bg-background/95 backdrop-blur-sm text-foreground',
        variant === 'destructive' && 'border-red-200 bg-red-50/95 backdrop-blur-sm text-red-800 dark:border-red-800/50 dark:bg-red-950/95 dark:text-red-200',
        variant === 'success' && 'border-green-200 bg-green-50/95 backdrop-blur-sm text-green-800 dark:border-green-800/50 dark:bg-green-950/95 dark:text-green-200',
        className
      )}
      {...props}
    />
  );
});
Toast.displayName = ToastPrimitives.Root.displayName;

// Status icon component for variants
const ToastIcon = ({ variant }: { variant?: 'default' | 'destructive' | 'success' }) => {
  if (variant === 'success') {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />;
  }
  if (variant === 'destructive') {
    return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />;
  }
  return <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
};

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive',
      className
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      'ml-auto shrink-0 rounded p-0.5 opacity-50 transition-opacity hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring',
      className
    )}
    toast-close=""
    {...props}
  >
    <X className="h-3 w-3" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title ref={ref} className={cn('text-xs font-medium leading-tight', className)} {...props} />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn('text-[11px] opacity-75 leading-tight', className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
  ToastIcon,
};

// Toaster component that renders all toasts
// Minimal design: small, unobtrusive notifications in bottom-right corner
interface ToasterProps {
  toasts: ToastType[];
  onDismiss: (id: string) => void;
}

export function Toaster({ toasts, onDismiss }: ToasterProps) {
  // Only show the most recent 3 toasts to avoid clutter
  const visibleToasts = toasts.slice(-3);

  return (
    <ToastProvider swipeDirection="right">
      {visibleToasts.map((toast) => (
        <Toast key={toast.id} variant={toast.variant} duration={toast.duration}>
          <ToastIcon variant={toast.variant} />
          <div className="flex-1 min-w-0">
            <ToastTitle className="truncate">{toast.title}</ToastTitle>
            {toast.description && (
              <ToastDescription className="line-clamp-2">{toast.description}</ToastDescription>
            )}
          </div>
          <ToastClose onClick={() => onDismiss(toast.id)} />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
