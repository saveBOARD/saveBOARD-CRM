"use server";

import { refresh } from "next/cache";
import { signIn } from "@/auth";
import type { ActionState } from "@/lib/action-state";
import { requireUser } from "@/server/auth/session";
import { deleteMailAccount } from "@/server/mail/accounts";
import { mailKeyStatus } from "@/server/mail/crypto";
import { forgetGraphToken, MAIL_SCOPES, testMailConnection } from "@/server/mail/graph";

// Connecting Outlook: sign in again with Microsoft, asking for mail access (read + drafts, never send).

export async function connectOutlook(): Promise<void> {
  await requireUser();
  if (!mailKeyStatus().ok) throw new Error("Outlook connections are not set up on this server yet (MAIL_TOKEN_KEY).");
  await signIn("microsoft-entra-id", { redirectTo: "/settings/outlook?connected=1" }, { scope: MAIL_SCOPES });
}

export async function disconnectOutlook(): Promise<void> {
  const user = await requireUser();
  await deleteMailAccount({ type: "user", profileId: user.id }, user.id);
  forgetGraphToken(user.id);
  refresh();
}

export async function testOutlook(): Promise<ActionState> {
  const user = await requireUser();
  try {
    const inbox = await testMailConnection(user.id);
    return {
      ok: true,
      message: `Connected: your Inbox has ${inbox.totalItemCount.toLocaleString("en-NZ")} emails (${inbox.unreadItemCount.toLocaleString("en-NZ")} unread).`,
      savedAt: Date.now(),
    };
  } catch (e) {
    refresh();
    return { ok: false, message: e instanceof Error ? e.message : "The test failed." };
  }
}
