import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import { TONE_CLASS, type Tone } from "@/lib/labels";

// Detail-page pieces from the ERP design (docs/erp-reference/Design.md §5 "Detail page", §3 status colours).

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mb-3 inline-flex items-center gap-1 text-sm text-link hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {children}
    </Link>
  );
}

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={clsx("rounded px-3 py-1 text-sm font-medium", TONE_CLASS[tone])}>{children}</span>;
}

export function HeaderCard({
  eyebrow,
  title,
  subtitle,
  pills,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: React.ReactNode;
  pills?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <div className="eyebrow">{eyebrow}</div>
          <h1 className="text-2xl font-medium break-words">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
        </div>
        {pills && <div className="ml-auto flex flex-wrap gap-2">{pills}</div>}
      </div>
      {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
      {children && <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>}
    </section>
  );
}

export function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={clsx("grid content-start gap-1", wide && "sm:col-span-2 lg:col-span-4")}>
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm break-words">{children || <span className="text-muted">-</span>}</span>
    </div>
  );
}

export function Panel({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="font-medium">{title}</h2>
        {actions && <div className="ml-auto flex gap-2">{actions}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
