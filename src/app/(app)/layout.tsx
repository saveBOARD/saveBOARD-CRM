import { TopBar } from "@/components/shell/top-bar";

// Signed-in app shell. Sign-in (step 1.5) will guard this group and fill the user menu slot.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <TopBar />
      <main className="flex-1 px-4 py-4 sm:px-6">{children}</main>
    </>
  );
}
