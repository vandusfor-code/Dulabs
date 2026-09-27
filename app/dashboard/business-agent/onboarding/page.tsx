"use client";

// Business Agent 2.0, FASE 6 — configuración guiada (ruta /dashboard/business-agent/onboarding).
// Reutiliza tal cual los módulos del Business Agent que editan datos que ya viven en tablas (servicios, productos,
// calendario, preguntas frecuentes): el borrador no los duplica.

import { useMemo } from "react";
import { useDashboard } from "@/lib/dashboard-session";
import { blankSpecForm, emptyCapabilities, type EditableBusinessAgentSpecForm } from "@/lib/business-agent-form";
import { OnboardingFlow } from "@/components/dashboard/business-agent/onboarding/OnboardingFlow";
import { ServicesModule } from "@/components/dashboard/business-agent/ServicesModule";
import { ProductsModule } from "@/components/dashboard/business-agent/ProductsModule";
import { CalendarConnection } from "@/components/dashboard/business-agent/CalendarConnection";
import { KnowledgeModule } from "@/components/dashboard/business-agent/KnowledgeModule";
import type { OnboardingDraft } from "@/lib/agent-compiler/onboarding/draft";

/** El módulo de conocimiento trabaja sobre la forma del editor avanzado: se le da una vista del borrador y se traduce de vuelta. */
function knowledgeSlot(draft: OnboardingDraft, setDraft: (u: (d: OnboardingDraft) => OnboardingDraft) => void) {
  const base = blankSpecForm();
  const form: EditableBusinessAgentSpecForm = {
    ...base,
    capabilities: { ...emptyCapabilities(["faq"]), humanHandoff: draft.support.handoff },
    knowledge: { authority: "secondary", documents: [], onNoAnswer: draft.support.whenUnknown === "handoff" ? "handoff" : "message", ...(draft.support.unknownMessage ? { noAnswerMessage: draft.support.unknownMessage } : {}) },
  };
  return (
    <KnowledgeModule
      form={form}
      onChange={(f) =>
        setDraft((d) => ({
          ...d,
          support: { ...d.support, whenUnknown: f.knowledge.onNoAnswer === "handoff" ? "handoff" : "say_so", unknownMessage: f.knowledge.noAnswerMessage?.slice(0, 300) || undefined },
        }))
      }
    />
  );
}

export default function BusinessAgentOnboardingPage() {
  const { session, rol } = useDashboard();
  const auth = useMemo(() => (session ? { accessToken: session.access_token } : null), [session]);
  if (rol && rol !== "admin") {
    return (
      <div className="px-4 py-10 md:px-8">
        <p className="text-sm text-mist">Solo un administrador de tu cuenta puede configurar el agente.</p>
      </div>
    );
  }
  return <OnboardingFlow auth={auth} slots={{ services: <ServicesModule />, products: <ProductsModule />, calendar: <CalendarConnection />, knowledge: knowledgeSlot }} />;
}
