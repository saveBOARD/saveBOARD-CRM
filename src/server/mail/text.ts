import "server-only";
import { GraphError, graphGet } from "./graph";

// Fetch one email's text from Outlook, to hand to Claude. The text is used and dropped: the CRM never stores it.

export type MessageText = {
  body?: { content?: string } | null;
  uniqueBody?: { content?: string } | null;
  from?: { emailAddress?: { address?: string } } | null;
  toRecipients?: { emailAddress?: { address?: string } }[] | null;
  ccRecipients?: { emailAddress?: { address?: string } }[] | null;
};

const FIELDS = "uniqueBody,body,from,toRecipients,ccRecipients";
const PREFER = { Prefer: 'outlook.body-content-type="text"' };

/**
 * By Graph id when we have one; moving a message to another folder gives it a new id, so otherwise (or on 404) look
 * it up by its internet message id. Null if it no longer exists.
 */
export async function fetchMessageText(
  readerId: string,
  mailbox: string,
  messageId: string | null,
  internetMessageId: string,
  fetchImpl?: typeof fetch,
): Promise<MessageText | null> {
  const box = `/users/${encodeURIComponent(mailbox)}`;
  if (messageId) {
    try {
      return await graphGet<MessageText>(readerId, `${box}/messages/${encodeURIComponent(messageId)}?$select=${FIELDS}`, fetchImpl, PREFER);
    } catch (e) {
      if (!(e instanceof GraphError && e.status === 404)) throw e;
    }
  }
  const filter = encodeURIComponent(`internetMessageId eq '${internetMessageId.replace(/'/g, "''")}'`);
  const found = await graphGet<{ value?: MessageText[] }>(readerId, `${box}/messages?$filter=${filter}&$select=${FIELDS}&$top=1`, fetchImpl, PREFER);
  return found.value?.[0] ?? null;
}

/** The new part of the email (without the quoted thread) when Outlook provides it, tidied. */
export function messageText(m: MessageText): string {
  return (m.uniqueBody?.content || m.body?.content || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const addressOf = (r: { emailAddress?: { address?: string } } | null | undefined) => r?.emailAddress?.address?.toLowerCase() ?? null;
