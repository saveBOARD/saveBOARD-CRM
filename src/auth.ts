import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { authStatus } from "@/server/auth/config";
import { claimProfile, type Role } from "@/server/auth/profiles";

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
    async signIn({ profile }) {
      const status = authStatus();
      const claims = (profile ?? {}) as EntraClaims;
      if (!status.configured || claims.tid?.toLowerCase() !== status.tenantId || !claims.oid) return false;
      const match = await claimProfile([claims.email ?? "", claims.preferred_username ?? ""], claims.oid);
      return match !== null;
    },
    async jwt({ token, profile }) {
      if (profile) {
        // Just signed in (signIn above already allowed it): record which CRM profile this is.
        const claims = profile as EntraClaims;
        const match = await claimProfile([claims.email ?? "", claims.preferred_username ?? ""], claims.oid ?? "");
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
