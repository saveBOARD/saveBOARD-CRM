# saveBOARD CRM

The saveBOARD CRM tracks every enquiry from first contact to an ERP sales order. It captures Outlook email and post-call voice notes, and builds a daily chase list so no lead goes quiet. It replaces HubSpot.

- Design brief: [docs/DESIGN.md](docs/DESIGN.md)
- Working rules for Claude Code: [CLAUDE.md](CLAUDE.md)
- Database migrations and run order: [supabase/README.md](supabase/README.md)

Stack: Next.js on Vercel (Sydney), Supabase Postgres (the ERP's project, separate `crm` schema), Microsoft 365 sign-in and Graph, and the Claude API.
