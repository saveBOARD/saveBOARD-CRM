# Microsoft 365 app registration for saveBOARD CRM

**For:** saveBOARD's IT provider (Microsoft 365 / Entra ID administrator).
**Why:** the saveBOARD CRM (https://saveboard-crm.vercel.app) lets staff sign in with their Microsoft 365 account. Later it will also read each user's own Outlook mail to log customer emails and save follow-up emails as **drafts** for the user to send. It never sends mail itself.
**Time:** about 10 minutes. All four users (paul@saveboard.nz, mark@saveboard.com.au, iris@saveboard.nz, dave@saveboard.nz) are in the same tenant.

## Steps (Microsoft Entra admin center, https://entra.microsoft.com)

1. **Create the registration.** Go to *Identity > Applications > App registrations > New registration*.
   - **Name:** `saveBOARD CRM`
   - **Supported account types:** *Accounts in this organizational directory only (single tenant)*
   - **Redirect URI:** platform **Web**, `http://localhost:3000/api/auth/callback/microsoft-entra-id`
   - Click **Register**.

2. **Add the live redirect URI.** In the new app, go to *Authentication > Web > Add URI* and add:
   `https://saveboard-crm.vercel.app/api/auth/callback/microsoft-entra-id`
   Leave *Implicit grant* (access tokens and ID tokens) **unticked**. Save.

3. **Create a client secret.** Go to *Certificates & secrets > Client secrets > New client secret*.
   - **Description:** `saveBOARD CRM`, **Expires:** 24 months.
   - Copy the secret's **Value** straight away (it is shown once). Not the "Secret ID".
   - Please note the expiry date: the secret must be renewed before then or sign-in stops working.

4. **Set API permissions.** Go to *API permissions > Add a permission > Microsoft Graph > Delegated permissions* and add:
   `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Mail.ReadWrite`, `Mail.Read.Shared` (added 8 Oct 2026)
   Then click **Grant admin consent for saveBOARD**.
   - **Do not add** `Mail.Send`, and **do not add any Application permissions**. The CRM must only act as the signed-in user, and must not be able to send mail.
   - `Mail.ReadWrite` is needed so the CRM can read the user's own Inbox and Sent Items and create draft emails.
   - `Mail.Read.Shared` lets the CRM read the shared mailboxes the user can already open (enquiries@saveboard.nz, sales@saveboard.com.au), where website enquiries land. Read only.

5. **Limit it to the CRM users (recommended).** Go to *Identity > Applications > Enterprise applications > saveBOARD CRM*:
   - *Properties*: set **Assignment required?** to **Yes**. Save.
   - *Users and groups > Add user/group*: add Paul Charteris, Mark Atkinson, Iris Lim and Dave Elder.

   (The CRM also checks its own user list, so this is a second lock.)

## What to send back to Paul

| Item | Where to find it | How to send |
|---|---|---|
| **Directory (tenant) ID** | App's *Overview* page | Email is fine |
| **Application (client) ID** | App's *Overview* page | Email is fine |
| **Client secret Value** | From step 3 | **Securely only**: password manager share or a one-time secret link. Not plain email or chat. |
| Secret expiry date | From step 3 | Email is fine |

## For Paul: where the values go (not for the IT provider)

In Vercel (*saveboard-crm > Settings > Environment Variables*, Production and Preview), and in your local `.env.local` for testing:

| Variable | Value |
|---|---|
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Application (client) ID |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Client secret Value |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | `https://login.microsoftonline.com/<Directory (tenant) ID>/v2.0` |
| `AUTH_SECRET` | A random string; Claude will tell you how to generate it |

Never paste any of these into chat with Claude.
