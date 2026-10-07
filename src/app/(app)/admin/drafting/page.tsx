import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/detail";
import { requireAdmin } from "@/server/auth/session";
import { DRAFT_MODEL } from "@/server/claude/draft";
import { getVoiceExamples } from "@/server/crm/settings";
import { VoiceForm } from "./voice-form";

export const metadata: Metadata = { title: "Claude drafts" };

export default async function DraftingPage() {
  await requireAdmin();
  const current = await getVoiceExamples();
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <PageHeader title="Claude drafts" />
      <Panel title="Your writing style">
        <div className="grid gap-4">
          <p className="text-sm text-muted">
            On the Today page, <b>Draft</b> asks Claude ({DRAFT_MODEL}) to write a follow-up using the deal, the contact and the recent email
            summaries. You check it, save it to your Outlook Drafts, and send it from Outlook. The CRM never sends email.
            {current ? "" : " Until you add examples here, drafts use a plain, friendly NZ business style."}
          </p>
          <VoiceForm current={current} />
        </div>
      </Panel>
    </div>
  );
}
