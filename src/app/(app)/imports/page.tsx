import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Imports" };

export default function ImportsPage() {
  return (
    <>
      <PageHeader title="Imports" />
      <EmptyState>HubSpot loads and consultant visit uploads will be listed here, with what each one created, updated and skipped.</EmptyState>
    </>
  );
}
