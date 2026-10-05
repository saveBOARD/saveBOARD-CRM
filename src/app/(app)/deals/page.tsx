import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { Plus } from "lucide-react";
import { DealsBoard } from "@/components/deals/deals-board";
import { PageHeader } from "@/components/shell/page-header";
import { requireUser } from "@/server/auth/session";
import { listBoardDeals } from "@/server/crm/deals";
import { settingInt } from "@/server/crm/settings";

export const metadata: Metadata = { title: "Deals" };

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx("rounded border px-3 py-1 text-sm", active ? "border-primary bg-primary text-white" : "border-line bg-surface hover:bg-page")}
    >
      {children}
    </Link>
  );
}

export default async function DealsPage({ searchParams }: PageProps<"/deals">) {
  const user = await requireUser();
  const sp = await searchParams;
  const mine = sp.mine === "1";
  const entity = sp.entity === "NZ" || sp.entity === "AUS" ? sp.entity : undefined;
  const [deals, staleDays] = await Promise.all([
    listBoardDeals({ ownerId: mine ? user.id : undefined, entity }),
    settingInt("stale_days"),
  ]);

  const href = (o: { mine?: boolean; entity?: string }) => {
    const q = new URLSearchParams();
    if (o.mine ?? mine) q.set("mine", "1");
    const e = "entity" in o ? o.entity : entity;
    if (e) q.set("entity", e);
    const s = q.toString();
    return s ? `/deals?${s}` : "/deals";
  };

  return (
    <>
      <PageHeader
        title="Deals"
        actions={
          <Link href="/deals/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            New deal
          </Link>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <Tab href={href({ mine: false })} active={!mine}>
          All deals
        </Tab>
        <Tab href={href({ mine: true })} active={mine}>
          My deals
        </Tab>
        <span className="mx-1 w-px bg-line" aria-hidden />
        <Tab href={href({ entity: undefined })} active={!entity}>
          NZ and AUS
        </Tab>
        <Tab href={href({ entity: "NZ" })} active={entity === "NZ"}>
          New Zealand
        </Tab>
        <Tab href={href({ entity: "AUS" })} active={entity === "AUS"}>
          Australia
        </Tab>
      </div>
      <DealsBoard deals={deals} staleDays={staleDays} showOwner={!mine} />
    </>
  );
}
