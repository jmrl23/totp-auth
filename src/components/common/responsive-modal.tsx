"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Wider dialog on desktop (Add entry, Import). */
  wide?: boolean;
};

/** Bottom sheet on phones, centred dialog from `md`. Same content either way. */
export function ResponsiveModal({ open, onOpenChange, title, description, children, wide }: Props) {
  const isDesktop = useIsDesktop();
  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn("max-h-[min(90dvh,52rem)] overflow-y-auto", wide ? "sm:max-w-xl" : "sm:max-w-md")}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <DialogHeader className="pr-10">
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent {...(description ? {} : { "aria-describedby": undefined })}>
        <DrawerHeader className="pad-safe-x text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle>{title}</DrawerTitle>
          {description ? <DrawerDescription>{description}</DrawerDescription> : null}
        </DrawerHeader>
        <div className="pad-safe-x pad-safe-bottom overflow-y-auto">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
