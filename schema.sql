-- ============ TABLES ============
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now()
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  workflow_type text not null check (workflow_type in
    ('Accounts Payable Processor', 'Quotation Assistant', 'Customer Inquiry Bot')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  input text not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  output text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer
);

-- ============ HELPER: organization of the logged in user ============
create or replace function public.my_org_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select org_id from public.profiles where id = auth.uid()
$$;

-- ============ SIGN UP TRIGGER ============
-- If there is a pending invitation for the email, the user joins that org as member.
-- Otherwise a new organization is created and the user is its admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_org_id uuid;
  v_invite_id uuid;
begin
  select id, org_id into v_invite_id, v_org_id
  from public.invitations
  where lower(email) = lower(new.email) and status = 'pending'
  order by created_at desc
  limit 1;

  if v_invite_id is not null then
    insert into public.profiles (id, org_id, email, role)
    values (new.id, v_org_id, new.email, 'member');
    update public.invitations set status = 'accepted' where id = v_invite_id;
  else
    insert into public.organizations (name)
    values (coalesce(nullif(new.raw_user_meta_data ->> 'org_name', ''), new.email || ' organization'))
    returning id into v_org_id;
    insert into public.profiles (id, org_id, email, role)
    values (new.id, v_org_id, new.email, 'admin');
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ ROW LEVEL SECURITY ============
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.invitations enable row level security;
alter table public.agents enable row level security;
alter table public.agent_runs enable row level security;

create policy "read own org" on public.organizations
  for select to authenticated using (id = public.my_org_id());

create policy "read org members" on public.profiles
  for select to authenticated using (org_id = public.my_org_id());

create policy "read org invitations" on public.invitations
  for select to authenticated using (org_id = public.my_org_id());

create policy "admins invite" on public.invitations
  for insert to authenticated with check (
    org_id = public.my_org_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "org agents" on public.agents
  for all to authenticated
  using (org_id = public.my_org_id())
  with check (org_id = public.my_org_id());

create policy "read org runs" on public.agent_runs
  for select to authenticated using (org_id = public.my_org_id());

create policy "create org runs" on public.agent_runs
  for insert to authenticated with check (
    org_id = public.my_org_id()
    and status = 'pending'
    and exists (select 1 from public.agents a where a.id = agent_id and a.org_id = public.my_org_id())
  );
-- No update policy on agent_runs: only the backend worker (service role) changes status.
