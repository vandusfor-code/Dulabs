"use client";

import type { ReactNode } from "react";
import { DashboardSessionProvider } from "@/lib/dashboard-session";
import { Shell } from "./shell/Shell";

export default function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <div className="dash-scope">
      <DashboardSessionProvider>
        <Shell>{children}</Shell>
      </DashboardSessionProvider>
    </div>
  );
}
