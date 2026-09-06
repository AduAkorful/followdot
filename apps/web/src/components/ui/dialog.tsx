'use client';

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

function Dialog({
  children,
  open,
  onOpenChange,
  defaultOpen,
}: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen}>
      {children}
    </DialogPrimitive.Root>
  );
}

function DialogTrigger({ children }: { children: React.ReactNode }) {
  return <DialogPrimitive.Trigger>{children}</DialogPrimitive.Trigger>;
}

function DialogContent({ className, children, ...props }: { className?: string; children?: React.ReactNode } & React.ComponentPropsWithoutRef<'div'>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" />
      <DialogPrimitive.Popup
        {...props}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4',
          'overflow-y-auto max-h-[90vh] p-6',
          'rounded-[var(--radius-lg)] border border-[var(--border)]',
          'bg-[var(--bg-card)] text-[var(--text-primary)]',
          'shadow-[var(--shadow-card),0_24px_64px_rgba(0,0,0,0.55)]',
          className,
        )}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-[var(--radius-sm)] p-1 text-[var(--text-muted)] opacity-80 transition-opacity hover:opacity-100 hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex justify-end gap-2 space-x-0", className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg font-semibold leading-none tracking-tight text-[var(--text-primary)]", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-[var(--text-secondary)]", className)}
      {...props}
    />
  );
}

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
