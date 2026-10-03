import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { safeCallback } from "@/lib/safe-redirect";
import { authStatus } from "@/server/auth/config";
import { currentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  AccessDenied: "That Microsoft account isn't set up for the CRM. Ask Paul to add you, then try again.",
  Configuration: "Sign-in isn't working on the server. Tell Paul: the sign-in settings need checking.",
  Verification: "The sign-in link has expired. Please try again.",
};

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const params = await searchParams;
  const callbackUrl = safeCallback(params.callbackUrl);
  if (await currentUser()) redirect(callbackUrl);

  const status = authStatus();
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const error = errorKey ? (ERRORS[errorKey] ?? "Sign-in didn't work. Please try again.") : undefined;

  async function signInWithMicrosoft() {
    "use server";
    await signIn("microsoft-entra-id", { redirectTo: callbackUrl });
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="card w-full max-w-sm p-6">
        <Image src="/logo.png" alt="saveBOARD" width={600} height={181} priority className="mx-auto h-auto w-48" />
        <h1 className="mt-6 text-center text-xl font-medium">Sign in to the CRM</h1>

        {error && (
          <p role="alert" className="mt-4 rounded bg-bad/10 px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}

        {status.configured ? (
          <form action={signInWithMicrosoft} className="mt-6">
            <button type="submit" className="btn-primary w-full justify-center">
              Sign in with Microsoft
            </button>
            <p className="mt-3 text-center text-xs text-muted">Use your saveBOARD Microsoft 365 account.</p>
          </form>
        ) : (
          <p className="mt-6 rounded bg-pending px-3 py-2 text-sm">
            Sign-in isn&apos;t set up on this server yet, so the CRM is locked.
          </p>
        )}
      </div>
    </main>
  );
}
