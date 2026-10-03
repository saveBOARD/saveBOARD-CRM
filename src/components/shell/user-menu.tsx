import { Activity, LogOut } from "lucide-react";
import Link from "next/link";
import { signOut } from "@/auth";
import type { Profile } from "@/server/auth/profiles";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

// ERP-style user menu: initials in a circle, a <details> dropdown with admin links and Sign out.
export function UserMenu({ user }: { user: Profile }) {
  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  return (
    <details className="relative">
      <summary
        className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full bg-[#4a6275] text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-primary/20"
        aria-label={`Account menu for ${user.displayName}`}
        title={user.displayName}
      >
        {initials(user.displayName)}
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-60 rounded-md bg-surface py-1 text-sm text-ink shadow-lg ring-1 ring-line">
        <div className="border-b border-line px-4 py-2">
          <div className="font-medium">{user.displayName}</div>
          <div className="truncate text-xs text-muted">{user.email}</div>
        </div>
        {user.role === "admin" && (
          <Link href="/admin/health" className="flex items-center gap-2 px-4 py-2 hover:bg-page">
            <Activity className="h-4 w-4" aria-hidden />
            System health
          </Link>
        )}
        <form action={signOutAction}>
          <button type="submit" className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-page">
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
