'use client';
/**
 * shadcn/ui-style primitives built on Radix UI.
 */
import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { X, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[12.5px] font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-ink-950 hover:bg-accent-strong shadow-[0_1px_0_rgba(255,255,255,0.25)_inset]',
        secondary: 'bg-white/[0.06] text-ink-100 hover:bg-white/[0.1] border border-white/[0.06]',
        ghost: 'text-ink-200 hover:bg-white/[0.06] hover:text-ink-100',
        outline: 'border border-white/10 text-ink-100 hover:bg-white/[0.05]',
        danger: 'bg-danger/90 text-white hover:bg-danger',
        subtle: 'bg-accent-soft text-accent hover:bg-accent/20',
      },
      size: {
        sm: 'h-7 px-2.5',
        md: 'h-8 px-3',
        lg: 'h-10 px-4 text-[13.5px]',
        icon: 'h-8 w-8',
        iconSm: 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, loading, children, ...props }, ref) => {
  // As a Slot (asChild) the child element is rendered as-is: Slot needs exactly one child.
  if (asChild) {
    return (
      <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
});
Button.displayName = 'Button';

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children, side = 'top', shortcut }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; shortcut?: string }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[100] flex items-center gap-2 rounded-md border border-white/10 bg-ink-800/95 px-2 py-1 text-[11.5px] text-ink-100 shadow-panel backdrop-blur animate-fade-in"
        >
          {content}
          {shortcut ? <span className="kbd">{shortcut}</span> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function IconButton({
  label,
  shortcut,
  active,
  className,
  side,
  children,
  ...props
}: ButtonProps & { label: string; shortcut?: string; active?: boolean; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={side}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={active}
        className={cn('text-ink-300', active && 'bg-accent-soft text-accent hover:bg-accent/20 hover:text-accent', className)}
        {...props}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, title, description, wide }: { className?: string; children: React.ReactNode; title: string; description?: string; wide?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-white/[0.08] bg-ink-850 shadow-2xl animate-fade-in',
          wide ? 'max-w-[1280px]' : 'max-w-[520px]',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
          <div>
            <DialogPrimitive.Title className="text-[15px] font-semibold text-ink-100">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="mt-0.5 text-[12.5px] text-ink-300">{description}</DialogPrimitive.Description> : null}
          </div>
          <DialogPrimitive.Close className="rounded-md p-1 text-ink-300 hover:bg-white/5 hover:text-ink-100" aria-label="Close">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="max-h-[calc(92vh-64px)] overflow-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex gap-0.5 rounded-lg bg-white/[0.04] p-0.5', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-medium text-ink-300 transition hover:text-ink-100 data-[state=active]:bg-white/[0.08] data-[state=active]:text-ink-100 data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export function DropdownMenuContent({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={6}
        className={cn('z-[90] min-w-[200px] rounded-lg border border-white/10 bg-ink-800/95 p-1 shadow-panel backdrop-blur-xl animate-fade-in', className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}
export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={cn('flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink-100 outline-none data-[highlighted]:bg-white/[0.07] data-[disabled]:opacity-40', className)}
      {...props}
    />
  );
}
export const DropdownMenuSeparator = () => <DropdownPrimitive.Separator className="my-1 h-px bg-white/[0.06]" />;
export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return <DropdownPrimitive.Label className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-400">{children}</DropdownPrimitive.Label>;
}

export function Badge({ className, tone = 'neutral', children }: { className?: string; tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info'; children: React.ReactNode }) {
  const tones = {
    neutral: 'bg-white/[0.06] text-ink-200 border-white/[0.06]',
    accent: 'bg-accent-soft text-accent border-accent/20',
    success: 'bg-success/10 text-success border-success/20',
    warn: 'bg-warn/10 text-warn border-warn/20',
    danger: 'bg-danger/10 text-danger border-danger/20',
    info: 'bg-info/10 text-info border-info/20',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium', tones[tone], className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-ink-300', className)} />;
}

export function Separator({ vertical, className }: { vertical?: boolean; className?: string }) {
  return <div className={cn(vertical ? 'mx-1 h-5 w-px' : 'my-2 h-px w-full', 'bg-white/[0.07]', className)} />;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-4 w-7 shrink-0 rounded-full transition', checked ? 'bg-accent' : 'bg-white/15')}
    >
      <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all', checked ? 'left-3.5' : 'left-0.5')} />
    </button>
  );
}
