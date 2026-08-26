"use client";

import { useParams } from "next/navigation";
import { AgendaProvider } from "@/components/spa-panel/AgendaContext";

export default function AgendaLayout({ children }: { children: React.ReactNode }) {
  const { token } = useParams<{ token: string }>();
  return <AgendaProvider token={token}>{children}</AgendaProvider>;
}
