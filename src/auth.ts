import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { authStatus } from "@/server/auth/config";
import { graphAddresses } from "@/server/auth/graph";
import { claimProfile, profileByOid, type Role } from "@/server/auth/profiles";

function refuse(reason: string) {
  console.warn(`[auth] sign-in refused: ${reason}`);
  return false;
}

// Microsoft 365 sign-in (Auth.js). Single tenant, and only people with an active crm.profiles row get in.
// Phase 1 asks only for sign-in scopes. Mail scopes arrive with Outlook capture (phase 3); the permission to
// send mail is never requested (CLAUDE.md hard rule 4, enforced by boundaries.test.ts).

declare module "next-auth" {
  interface Session {
    user: { profileId: string; role: Role; name: string; email: string };
  }
}
declare module "@auth/core/jwt" {
  interface JWT {
    profileId?: string;
    role?: Role;
  }
}

type EntraClaims = { oid?: string; tid?: string; email?: string; preferred_username?: string; name?: string };

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      authorization: { params: { scope: "openid profile email User.Read" } },
      // Replaces the default, which downloads the profile photo into the session cookie.
      profile(p: EntraClaims & { sub: string }) {
        return { id: p.oid ?? p.sub, name: p.name, email: p.email ?? p.preferred_username ?? null, image: null };
      },
    }),
  ],
  pages: { signIn: "/signin", error: "/signin" },
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  callbacks: {
    async signIn({ profile, account }) {
      const status = authStatus();
      const claims = (profile ?? {}) as EntraClaims;
      // Refusals are logged with the reason (Vercel > Logs), so a failed sign-in can be diagnosed.
      if (!status.configured) return refuse("sign-in settings incomplete");
      if (!claims.oid) return refuse("no account id (oid) in the Microsoft token");
      if (claims.tid?.toLowerCase() !== status.tenantId) return refuse(`account is from another tenant (${claims.tid})`);
      try {
        const fromToken = [claims.email ?? "", claims.preferred_username ?? ""];
        if (await claimProfile(fromToken, claims.oid)) return true;
        // The sign-in name (UPN) can differ from the email the CRM knows: ask Graph for the account's addresses.
        const fromGraph = account?.access_token ? await graphAddresses(account.access_token) : [];
        if (await claimProfile(fromGraph, claims.oid)) return true;
        return refuse(`no active CRM user with any of: ${[...new Set([...fromToken, ...fromGraph].filter(Boolean))].join(", ")}`);
      } catch (e) {
        return refuse(`error while checking the CRM user: ${e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : e}`);
      }
    },
    async jwt({ token, profile }) {
      if (profile) {
        // Just signed in: signIn above matched and claimed the profile for this Microsoft account (oid).
        const claims = profile as EntraClaims;
        const match = await profileByOid(claims.oid ?? "");
        if (!match) throw new Error("Profile no longer allowed");
        token.profileId = match.id;
        token.role = match.role;
        token.name = match.displayName;
        token.email = match.email;
      }
      return token;
    },
    session({ session, token }) {
      session.user = {
        ...session.user,
        profileId: token.profileId ?? "",
        role: token.role ?? "user",
        name: token.name ?? "",
        email: token.email ?? "",
      };
      return session;
    },
  },
});
