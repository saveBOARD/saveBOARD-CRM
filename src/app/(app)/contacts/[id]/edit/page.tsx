import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactForm } from "@/components/forms/contact-form";
import { BackLink } from "@/components/ui/detail";
import { isUuid } from "@/lib/ids";
import { requireUser } from "@/server/auth/session";
import { getContact } from "@/server/crm/contacts";
import { listUsers } from "@/server/crm/writes";

export const metadata: Metadata = { title: "Edit contact" };

export default async function EditContactPage({ params }: PageProps<"/contacts/[id]/edit">) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [contact, users] = await Promise.all([getContact(id), listUsers()]);
  if (!contact) notFound();
  return (
    <div className="mx-auto max-w-4xl">
      <BackLink href={`/contacts/${id}`}>{contact.name ?? contact.email ?? "Contact"}</BackLink>
      <h1 className="mb-4 text-xl font-medium">Edit contact</h1>
      <ContactForm contact={contact} users={users} defaultOwnerId={user.id} />
    </div>
  );
}
