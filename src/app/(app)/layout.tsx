import { TopBar } from "@/components/shell/top-bar";
import { UserMenu } from "@/components/shell/user-menu";
import { requireUser } from "@/server/auth/session";

// Signed-in app shell. requireUser() is the real access check: a valid session AND an active CRM profile.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <>
      <TopBar userSlot={<UserMenu user={user} />} />
      <main className="flex-1 px-4 py-4 sm:px-6">{children}</main>
    </>
  );
}
