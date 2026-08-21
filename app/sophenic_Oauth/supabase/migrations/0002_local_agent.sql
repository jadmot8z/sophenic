-- Sophenic local-agent metadata layer.
-- This migration intentionally does NOT create a cloud execution surface.
-- Hermes/Ollama actions stay on the user's machine; only sanitized metadata may
-- be synchronized later through a trusted Sophenic server endpoint.

alter table public.agent_sessions
  add column if not exists runtime text not null default 'hermes',
  add column if not exists provider text not null default 'custom',
  add column if not exists model_name text,
  add column if not exists device_id text,
  add column if not exists workspace_label text,
  add column if not exists sync_mode text not null default 'local_only',
  add column if not exists last_seen_at timestamptz;

alter table public.agent_sessions drop constraint if exists agent_sessions_status_check;
alter table public.agent_sessions
  add constraint agent_sessions_status_check
  check (status in ('disabled','pending','active','ended','error','revoked'));

alter table public.agent_sessions drop constraint if exists agent_sessions_sync_mode_check;
alter table public.agent_sessions
  add constraint agent_sessions_sync_mode_check
  check (sync_mode in ('local_only','metadata','transcript'));

-- Hermes can return once/session/always/deny. Cloud records mirror that model,
-- but remain informational until a trusted server sync endpoint is implemented.
alter table public.agent_capability_grants drop constraint if exists agent_capability_grants_decision_check;
alter table public.agent_capability_grants
  add constraint agent_capability_grants_decision_check
  check (decision in ('deny','ask','allow_once','allow_session','allow_always'));

alter table public.agent_capability_grants
  add column if not exists risk_level text not null default 'medium',
  add column if not exists source text not null default 'hermes';

alter table public.agent_capability_grants drop constraint if exists agent_capability_grants_risk_level_check;
alter table public.agent_capability_grants
  add constraint agent_capability_grants_risk_level_check
  check (risk_level in ('low','medium','high','critical'));

-- Cloud-side catalogue used later to distribute Sophenic's approved model
-- policy. Desktop keeps a built-in copy so local operation does not depend on
-- Supabase being reachable.
create table if not exists public.open_model_registry (
  id uuid primary key default gen_random_uuid(),
  family text not null,
  model_pattern text not null unique,
  license_spdx text not null,
  weights_license_reviewed boolean not null default false,
  commercial_use_reviewed boolean not null default false,
  enabled boolean not null default false,
  upstream text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.open_model_registry
  (family, model_pattern, license_spdx, weights_license_reviewed, commercial_use_reviewed, enabled, upstream, notes)
values
  ('Qwen 3.x', '(^|[/:_-])qwen3(\\.|[/:_-]|$)', 'Apache-2.0', true, true, true, 'QwenLM', 'Initial Sophenic local-agent allow-list.'),
  ('DeepSeek R1', '(^|[/:_-])deepseek-r1([/:_-]|$)', 'MIT', true, true, true, 'DeepSeek', 'Review distilled variants separately when they inherit another base-model license.')
on conflict (model_pattern) do update set
  license_spdx=excluded.license_spdx,
  weights_license_reviewed=excluded.weights_license_reviewed,
  commercial_use_reviewed=excluded.commercial_use_reviewed,
  enabled=excluded.enabled,
  upstream=excluded.upstream,
  notes=excluded.notes,
  updated_at=now();

-- Sanitized, optional telemetry/audit for the account owner. Never store raw
-- command text, local absolute paths, file contents, environment variables or
-- tool secrets in metadata.
create table if not exists public.agent_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_session_id uuid references public.agent_sessions(id) on delete cascade,
  event_kind text not null check (event_kind in ('session','model','tool','approval','error')),
  capability text,
  decision text,
  model_name text,
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_sessions_user_seen_idx on public.agent_sessions(user_id,last_seen_at desc);
create index if not exists agent_activity_user_created_idx on public.agent_activity_events(user_id,created_at desc);
create index if not exists agent_activity_session_created_idx on public.agent_activity_events(agent_session_id,created_at desc);

alter table public.open_model_registry enable row level security;
alter table public.agent_activity_events enable row level security;

create policy "open models readable"
  on public.open_model_registry for select to authenticated
  using (enabled or public.is_admin());

create policy "agent activity self read"
  on public.agent_activity_events for select to authenticated
  using (user_id=auth.uid() or public.is_admin());

-- No authenticated INSERT/UPDATE policies are added for agent_sessions,
-- capability grants, registry or activity events. Future sync writes must pass
-- through a server route using service_role after redaction/validation.

drop trigger if exists set_updated_at on public.open_model_registry;
create trigger set_updated_at before update on public.open_model_registry
for each row execute function public.set_updated_at();
