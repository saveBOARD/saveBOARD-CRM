import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Contacts" };

export default function ContactsPage() {
  return (
    <>
      <PageHeader title="Contacts" />
      <EmptyState>Contacts will appear here once the HubSpot data is loaded.</EmptyState>
    </>
  );
}
