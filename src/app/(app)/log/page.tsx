import type { Metadata } from "next";
import Link from "next/link";
import { NoteForm } from "@/components/calls/note-form";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/detail";
import { formatDateTime } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { requireUser } from "@/server/auth/session";
import { aboutLabel, listWaitingNotes } from "@/server/crm/calls";

export const metadata: Metadata = { title: "Log a call" };
// Claude reads the note before the confirm screen opens.
export const maxDuration = 60;

export default async function LogCallPage({ searchParams }: PageProps<"/log">) {
  const user = await requireUser();
  const sp = await searchParams;
  const contactId = isUuid(sp.contact) ? sp.contact : null;
  const dealId = isUuid(sp.deal) ? sp.deal : null;
  const [waiting, about] = await Promise.all([listWaitingNotes(user.id), aboutLabel(contactId, dealId)]);

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <PageHeader title="Log a call" />
      <Panel title="After the call">
        <NoteForm contactId={contactId} dealId={dealId} about={about} />
      </Panel>
      {waiting.length > 0 && (
        <Panel title="Waiting for you to check">
          <ul className="grid gap-2 text-sm">
            {waiting.map((n) => (
              <li key={n.id}>
                <Link href={`/log/${n.id}`} className="text-link hover:underline">
                  {n.summary ?? n.note ?? "Call note"}
                </Link>
                <span className="text-muted"> · {formatDateTime(n.created_at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

