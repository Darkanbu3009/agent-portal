# Multi-Tenant AI Agent Management Portal

Organizations sign up, manage their own AI agents and trigger simulated agent runs.
Each organization only sees its own data, enforced by PostgreSQL row level security (RLS) in Supabase.

## Stack
- Frontend: React + TypeScript (Vite) in `web/`
- Backend: Node.js + Express + TypeScript (run with tsx) in `server/`
- Database and auth: Supabase (PostgreSQL + RLS, email/password auth), schema in `schema.sql`

## Setup
1. Create a Supabase project. In SQL Editor, run `schema.sql`.
2. Authentication > Sign In / Providers > Email: turn off "Confirm email" (demo only).
3. Copy `server/.env.example` to `server/.env` and fill in SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
4. Copy `web/.env.example` to `web/.env` and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
5. Backend: `cd server && npm install && npm run dev` (http://localhost:4000)
6. Frontend: `cd web && npm install && npm run dev` (http://localhost:5173)

In GitHub Codespaces the dependencies are installed automatically by `.devcontainer/devcontainer.json`.
The service role key is only used in the backend. Never put it in the frontend.

## Design decisions
- Multi-tenancy: every table has `org_id`. RLS policies only allow rows where `org_id = my_org_id()`, which is resolved from `auth.uid()`.
- Security: the backend verifies the Supabase JWT and queries the database as that user, so RLS is enforced even if the API has a bug. Agents of another organization return 404.
- Sign up: a database trigger creates the organization and makes the user admin. If a pending invitation exists for the email, the user joins that organization as member instead.
- Invitations: mocked. The admin saves the invitation and the email is logged in the backend console.
- Agent runs: `POST /api/agents/:id/runs` saves the run as `pending` and returns 202. A background task moves it to `in_progress` and then `completed`, with a mocked output and the duration. Users cannot update runs (no RLS update policy); only the backend service role can.

## API
All endpoints require `Authorization: Bearer <supabase access token>`.

| Method | Path | Description |
|---|---|---|
| GET | /api/org | Organization, current user, members, invitations |
| POST | /api/invitations | Invite a user by email (admin only) |
| GET | /api/agents | List agents of the organization |
| POST | /api/agents | Create agent |
| PUT | /api/agents/:id | Edit agent |
| DELETE | /api/agents/:id | Delete agent |
| GET | /api/agents/:id/runs | List runs of an agent |
| POST | /api/agents/:id/runs | Trigger a run (async) |
