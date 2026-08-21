-- Sophenic core schema — PostgreSQL / Supabase
create extension if not exists pgcrypto;

create table if not exists public.plans (
  id text primary key,
  name text not null,
  daily_token_limit bigint not null default 100000,
  monthly_token_limit bigint not null default 1000000,
  monthly_cost_limit_usd numeric(12,6) not null default 10,
  max_conversations integer not null default 1000,
  created_at timestamptz not null default now()
);

insert into public.plans (id,name,daily_token_limit,monthly_token_limit,monthly_cost_limit_usd,max_conversations) values
('free','Free',50000,300000,5,250),
('pro','Pro',1000000,15000000,150,10000),
('business','Business',5000000,100000000,1500,100000)
on conflict (id) do update set name=excluded.name;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user','admin','support')),
  plan_id text not null default 'free' references public.plans(id),
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  locale text not null default 'fr',
  theme text not null default 'system' check (theme in ('light','dark','system')),
  custom_system_prompt text,
  preferred_model_id uuid,
  telemetry_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.models (
  id uuid primary key default gen_random_uuid(),
  openrouter_id text not null unique,
  name text not null,
  provider text not null,
  kind text not null default 'text' check (kind in ('text','image','multimodal','embedding')),
  description text,
  context_length bigint,
  input_cost_per_million numeric(18,8),
  output_cost_per_million numeric(18,8),
  capabilities jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  sort_order integer not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.models (id,openrouter_id,name,provider,kind,description,sort_order) values
('00000000-0000-4000-8000-000000000001','openrouter/auto','Auto Router','OpenRouter','text','Sélection automatique du modèle via OpenRouter.',0)
on conflict (openrouter_id) do nothing;

alter table public.user_settings drop constraint if exists user_settings_preferred_model_id_fkey;
alter table public.user_settings add constraint user_settings_preferred_model_id_fkey foreign key (preferred_model_id) references public.models(id) on delete set null;

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,name)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  title text not null default 'Nouvelle conversation',
  model_id uuid references public.models(id) on delete set null,
  model_snapshot text,
  archived boolean not null default false,
  pinned boolean not null default false,
  total_tokens bigint not null default 0,
  total_cost_usd numeric(14,8) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('system','user','assistant','tool')),
  content text not null default '',
  model_id uuid references public.models(id) on delete set null,
  model_snapshot text,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost_usd numeric(14,8) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  kind text not null check (kind in ('upload','generated_image','document','agent_artifact')),
  storage_bucket text not null,
  storage_path text not null unique,
  file_name text,
  mime_type text,
  size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  model_id uuid references public.models(id) on delete set null,
  provider_model text not null,
  usage_kind text not null check (usage_kind in ('chat','image','agent')),
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  cost_usd numeric(14,8) not null default 0,
  upstream_cost_usd numeric(14,8),
  generation_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status text not null default 'inactive',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hermes / autonomous agent V2 foundations. No executable capability is enabled by this schema.
create table if not exists public.agent_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  desktop_session_id text,
  status text not null default 'disabled' check (status in ('disabled','pending','active','revoked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_capability_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_session_id uuid references public.agent_sessions(id) on delete cascade,
  capability text not null,
  decision text not null default 'deny' check (decision in ('deny','ask','allow_once','allow_session')),
  resource_scope jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.tool_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected' check (status in ('disconnected','connected','expired','revoked')),
  secret_reference text,
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,provider)
);

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  enabled boolean not null default false,
  trigger_spec jsonb not null default '{}'::jsonb,
  action_spec jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_updated_idx on public.conversations(user_id,updated_at desc);
create index if not exists conversations_folder_idx on public.conversations(user_id,folder_id);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id,created_at);
create index if not exists usage_user_created_idx on public.usage_events(user_id,created_at desc);
create index if not exists usage_user_model_idx on public.usage_events(user_id,provider_model,created_at desc);
create index if not exists attachments_user_idx on public.attachments(user_id,created_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;

do $$ declare t text; begin foreach t in array array['profiles','user_settings','models','folders','conversations','subscriptions','agent_sessions','tool_connections','automations'] loop execute format('drop trigger if exists set_updated_at on public.%I',t); execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t); end loop; end $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id) values(new.id) on conflict do nothing;
  insert into public.user_settings(user_id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'name',split_part(coalesce(new.email,''),'@',1))) on conflict do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;

create or replace function public.increment_conversation_usage(p_conversation_id uuid,p_tokens bigint,p_cost numeric) returns void language plpgsql security definer set search_path=public as $$
begin update public.conversations set total_tokens=total_tokens+greatest(coalesce(p_tokens,0),0), total_cost_usd=total_cost_usd+greatest(coalesce(p_cost,0),0), updated_at=now() where id=p_conversation_id; end; $$;
revoke all on function public.increment_conversation_usage(uuid,bigint,numeric) from public,anon,authenticated;
grant execute on function public.increment_conversation_usage(uuid,bigint,numeric) to service_role;

alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.models enable row level security;
alter table public.folders enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.usage_events enable row level security;
alter table public.subscriptions enable row level security;
alter table public.agent_sessions enable row level security;
alter table public.agent_capability_grants enable row level security;
alter table public.tool_connections enable row level security;
alter table public.automations enable row level security;
alter table public.audit_logs enable row level security;

create policy "plans readable" on public.plans for select to authenticated using (true);
create policy "profile self read" on public.profiles for select to authenticated using (id=auth.uid() or public.is_admin());
create policy "settings self" on public.user_settings for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "enabled models readable" on public.models for select to authenticated using (enabled or public.is_admin());
create policy "folders self" on public.folders for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "conversations self" on public.conversations for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid() and (folder_id is null or exists(select 1 from public.folders f where f.id=folder_id and f.user_id=auth.uid())));
create policy "messages self read" on public.messages for select to authenticated using (user_id=auth.uid());
create policy "messages self insert" on public.messages for insert to authenticated with check (user_id=auth.uid() and exists(select 1 from public.conversations c where c.id=conversation_id and c.user_id=auth.uid()));
create policy "attachments self read" on public.attachments for select to authenticated using (user_id=auth.uid());
create policy "usage self read" on public.usage_events for select to authenticated using (user_id=auth.uid() or public.is_admin());
create policy "subscriptions self read" on public.subscriptions for select to authenticated using (user_id=auth.uid() or public.is_admin());
create policy "agent sessions self read" on public.agent_sessions for select to authenticated using (user_id=auth.uid());
create policy "agent grants self read" on public.agent_capability_grants for select to authenticated using (user_id=auth.uid());
create policy "tool connections self read" on public.tool_connections for select to authenticated using (user_id=auth.uid());
create policy "automations self read" on public.automations for select to authenticated using (user_id=auth.uid());
create policy "audit admin read" on public.audit_logs for select to authenticated using (public.is_admin());

-- Private media bucket. Writes are server-side via service_role; reads go through /api/media/:id.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('generated-media','generated-media',false,20971520,array['image/png','image/jpeg','image/webp','image/svg+xml']) on conflict(id) do update set public=false;

create or replace view public.user_usage_daily with (security_invoker=true) as
select user_id,date_trunc('day',created_at) as day,provider_model,sum(total_tokens)::bigint as total_tokens,sum(cost_usd)::numeric(14,8) as cost_usd,count(*)::bigint as generations
from public.usage_events group by user_id,date_trunc('day',created_at),provider_model;

create or replace view public.user_usage_monthly with (security_invoker=true) as
select user_id,date_trunc('month',created_at) as month,provider_model,sum(total_tokens)::bigint as total_tokens,sum(cost_usd)::numeric(14,8) as cost_usd,count(*)::bigint as generations
from public.usage_events group by user_id,date_trunc('month',created_at),provider_model;
