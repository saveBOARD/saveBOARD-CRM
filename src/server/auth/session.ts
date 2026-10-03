import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { authStatus } from "./config";
import { activeProfile, type Profile } from "./profiles";

// The real access check (the proxy only does a quick cookie check). Call it in every layout, page,
// server action and route handler that shows or changes CRM data.

/** The signed-in, still-active CRM user, or null. Memoised per request. */
export const currentUser = cache(async (): Promise<Profile | null> => {
  await connection(); // always decide per request, never at build time
  if (!authStatus().configured) return null;
  const session = await auth();
  const id = session?.user?.profileId;
  return id ? activeProfile(id) : null;
});

export async function requireUser(): Promise<Profile> {
  const user = await currentUser();
  if (!user) redirect("/signin");
  return user;
}

export async function requireAdmin(): Promise<Profile> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}
