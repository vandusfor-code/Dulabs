"use client";

import Link from "next/link";
import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./Sections";

/* =========================================================
   Template compartido para las páginas de servicio -- mismo
   sistema visual que el resto del sitio (site-*), para que no
   parezcan páginas distintas aunque vivan en rutas propias.
========================================================= */

export function ServiceBreadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12px] text-site-muted-fg">
      {items.map((item, i) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3 w-3 text-site-muted-fg/50" />}
          {item.href ? (
            <Link href={item.href} className="transition-colors hover:text-site-fg">
              {item.label}
            </Link>
          ) : (
            <span className="text-site-fg/85">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function ServiceHero({
  breadcrumb,
  eyebrow,
  title,
  description,
  ctaLabel,
  ctaHref,
  ctaExternal = false,
}: {
  breadcrumb: { label: string; href?: string }[];
  eyebrow: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  ctaExternal?: boolean;
}) {
  return (
    <section className="relative pt-24 pb-16 md:pt-32 md:pb-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <ServiceBreadcrumb items={breadcrumb} />
        <div className="mt-6 max-w-2xl">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-site-primary">{eyebrow}</p>
          <h1 className="mt-4 font-display text-[34px] font-medium leading-[1.08] tracking-[-0.025em] text-site-fg md:text-[48px]">
            {title}
          </h1>
          <p className="mt-5 text-[15.5px] leading-relaxed text-site-muted-fg md:text-[16.5px]">{description}</p>
          <div className="mt-8">
            <a
              href={ctaHref}
              {...(ctaExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="group inline-flex h-11 items-center rounded-full bg-site-primary px-5 text-[13.5px] font-medium text-site-primary-fg transition-all hover:brightness-110"
            >
              {ctaLabel}
              <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ServiceCapabilities({
  title,
  desc,
  items,
}: {
  title: string;
  desc?: string;
  items: string[];
}) {
  return (
    <section className="relative border-t border-site-border py-16 md:py-20">
      <div className="mx-auto max-w-[1440px] px-6">
        <SectionHeading eyebrow="" labelStyle="none" size="md" title={title} desc={desc} />
        <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item, i) => (
            <Reveal key={item} delay={i * 40}>
              <div className="flex items-start gap-3 rounded-xl border border-site-border bg-site-card/50 p-4">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-site-primary/10 ring-1 ring-site-primary/20">
                  <Check className="h-3 w-3 text-site-primary" />
                </div>
                <span className="text-[13.5px] leading-relaxed text-site-fg/90">{item}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ServiceCallout({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative border-t border-site-border py-14">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="rounded-2xl border border-site-primary/20 bg-site-primary/[0.05] p-6 md:p-8">
          <p className="max-w-2xl font-display text-[16.5px] font-medium leading-relaxed text-site-fg md:text-[18px]">
            {children}
          </p>
        </div>
      </div>
    </section>
  );
}

export function ServiceRelated({ items }: { items: { label: string; href: string }[] }) {
  return (
    <section className="relative border-t border-site-border py-16">
      <div className="mx-auto max-w-[1440px] px-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-site-muted-fg">También te puede interesar</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group inline-flex items-center gap-1.5 rounded-full border border-site-border bg-site-card/50 px-4 py-2 text-[13px] text-site-fg/90 transition-colors hover:border-white/20 hover:text-site-fg"
            >
              {item.label}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
