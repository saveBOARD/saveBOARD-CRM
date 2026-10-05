import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DealForm } from "@/components/forms/deal-form";
import { BackLink } from "@/components/ui/detail";
import { isUuid } from "@/lib/ids";
import { requireUser } from "@/server/auth/session";
import { getDeal } from "@/server/crm/deals";
import { DEAL_SOURCES } from "@/server/crm/schemas";
import { listUsers } from "@/server/crm/writes";

export const metadata: Metadata = { title: "Edit deal" };

const sources = Object.entries(DEAL_SOURCES).map(([value, label]) => ({ value, label }));

export default async function EditDealPage({ params }: PageProps<"/deals/[id]/edit">) {
  const user = await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [deal, users] = await Promise.all([getDeal(id), listUsers()]);
  if (!deal) notFound();
  return (
    <div className="mx-auto max-w-4xl">
      <BackLink href={`/deals/${id}`}>{deal.title}</BackLink>
      <h1 className="mb-4 text-xl font-medium">Edit deal</h1>
      <DealForm deal={deal} users={users} defaultOwnerId={user.id} sources={sources} />
    </div>
  );
}
