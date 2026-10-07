// The signed-in user's own email addresses from Microsoft Graph (/me, allowed by the User.Read permission).
// Needed because Microsoft's sign-in token carries the sign-in name (UPN), which can differ from the email
// address the CRM knows (e.g. paul@saveboard.onmicrosoft.com vs paul@saveboard.nz), and has no email claim
// for work accounts unless the tenant adds it.

type Me = { mail?: string | null; userPrincipalName?: string | null; otherMails?: string[] | null; proxyAddresses?: string[] | null };

/** All addresses on the account: primary mail, sign-in name, other mails, and smtp aliases. Pure, for tests. */
export function addressesFromMe(me: Me): string[] {
  const aliases = (me.proxyAddresses ?? []).filter((p) => /^smtp:/i.test(p)).map((p) => p.slice(5));
  return [me.mail, me.userPrincipalName, ...(me.otherMails ?? []), ...aliases].filter((a): a is string => !!a);
}

export async function graphAddresses(accessToken: string): Promise<string[]> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,otherMails,proxyAddresses", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Microsoft Graph /me returned ${res.status}`);
  return addressesFromMe((await res.json()) as Me);
}
