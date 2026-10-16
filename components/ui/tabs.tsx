"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("grid w-full grid-cols-2 items-center gap-1 border-b sm:flex", className)} {...props} />;
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger className={cn("shrink-0 border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=active]:border-primary data-[state=active]:text-foreground", className)} {...props} />;
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("mt-6 space-y-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=inactive]:hidden", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
