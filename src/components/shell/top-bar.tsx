"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Building2, ListChecks, SquareKanban, Upload, Users, type LucideIcon } from "lucide-react";

type Section = { href: string; label: string; icon: LucideIcon };

// Top-bar sections. Same pattern as the ERP: a 20px icon above a text-xs label.
const SECTIONS: Section[] = [
  { href: "/", label: "Today", icon: ListChecks },
  { href: "/deals", label: "Deals", icon: SquareKanban },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/imports", label: "Imports", icon: Upload },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function TopBar({ userSlot }: { userSlot?: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <header className="no-print bg-nav text-nav-ink">
      <div className="flex h-14 items-stretch gap-4 px-4 sm:px-6">
        {/* TODO: swap for public/logo-on-dark.png from the ERP repo (h-9) once supplied. */}
        <Link href="/" className="flex items-center gap-2 pr-2 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-primary/20">
          <span>
            save<span className="font-bold">BOARD</span>
          </span>
          <span className="text-sm font-normal text-nav-ink/70">CRM</span>
        </Link>

        <nav aria-label="Sections" className="flex items-stretch">
          {SECTIONS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex min-w-[68px] flex-col items-center justify-center gap-0.5 px-2 text-xs hover:bg-nav-hover focus:outline-none focus:ring-2 focus:ring-primary/20",
                  active && "bg-nav-hover font-medium",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">{userSlot}</div>
      </div>
    </header>
  );
}
