import Link from "next/link";
import { Calendar, ExternalLink, Mail, MapPin, MessageSquare, Phone, Settings, type LucideIcon } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format";
import { ACTIVITY_TYPES, type ActivityType } from "@/lib/labels";
import type { Activity } from "@/server/crm/activities";

const ICONS: Record<ActivityType, LucideIcon> = {
  email: Mail,
  call: Phone,
  meeting: Calendar,
  note: MessageSquare,
  visit: MapPin,
  system: Settings,
};

const DIRECTION: Record<Activity["direction"], string> = { inbound: "received", outbound: "sent", internal: "" };

export function Timeline({ items, empty }: { items: Activity[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ol className="grid gap-4">
      {items.map((a) => {
        const Icon = ICONS[a.type];
        return (
          <li key={a.id} className="flex gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-page text-primary">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                <span className="font-medium text-ink">
                  {ACTIVITY_TYPES[a.type]}
                  {DIRECTION[a.direction] && ` ${DIRECTION[a.direction]}`}
                </span>
                <span>{formatDateTime(a.occurred_at)}</span>
                {a.owner && <span>by {a.owner}</span>}
                {a.contact && a.contact_id && (
                  <Link href={`/contacts/${a.contact_id}`} className="text-link hover:underline">
                    {a.contact}
                  </Link>
                )}
                {a.deal && a.deal_id && (
                  <Link href={`/deals/${a.deal_id}`} className="text-link hover:underline">
                    {a.deal}
                  </Link>
                )}
                {a.origin === "hubspot" && <span>(from HubSpot)</span>}
              </div>
              {a.subject && <div className="text-sm font-medium">{a.subject}</div>}
              {a.summary && <p className="text-sm whitespace-pre-line">{a.summary}</p>}
              {(a.next_step || a.follow_up_on) && (
                <p className="text-sm">
                  <span className="text-muted">Next step: </span>
                  {a.next_step ?? "Follow up"}
                  {a.follow_up_on && <span className="text-muted"> (by {formatDate(a.follow_up_on)})</span>}
                </p>
              )}
              {a.origin === "graph" && a.type === "email" && !a.summary && <p className="text-xs text-muted">Summary on its way.</p>}
              {a.external_url && (
                <a href={a.external_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-link hover:underline">
                  Open in Outlook <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
