import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Companies" };

export default function CompaniesPage() {
  return (
    <>
      <PageHeader title="Companies" />
      <EmptyState>Companies will appear here once the HubSpot data is loaded.</EmptyState>
    </>
  );
}
