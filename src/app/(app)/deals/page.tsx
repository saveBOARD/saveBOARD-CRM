import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Deals" };

export default function DealsPage() {
  return (
    <>
      <PageHeader title="Deals" />
      <EmptyState>The deals board will appear here once deals are loaded.</EmptyState>
    </>
  );
}
