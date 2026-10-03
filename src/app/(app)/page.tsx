import { EmptyState, PageHeader } from "@/components/shell/page-header";

export default function TodayPage() {
  return (
    <>
      <PageHeader title="Today" />
      <EmptyState>
        Your chase list will appear here: deals gone quiet, unanswered quotes, expiring quotes and new enquiries.
      </EmptyState>
    </>
  );
}
