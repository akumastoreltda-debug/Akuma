alter table amazon_alert_settings
  add column if not exists notification_channel text
    check (notification_channel in ('slack', 'discord', 'microsoft_teams', 'webhook')),
  add column if not exists notification_destination_encrypted text;

create or replace function claim_amazon_module_alert(
  p_owner_clerk_id text,
  p_module text,
  p_is_degraded boolean,
  p_failure_category text,
  p_observed_latency_ms integer,
  p_degraded_samples integer,
  p_sample_window integer,
  p_evaluated_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_state amazon_module_alert_states%rowtype;
  should_alert boolean;
begin
  -- Serialize the first insert as well as updates for this owner/module pair.
  -- Without this lock, two concurrent evaluations could both observe no row.
  perform pg_advisory_xact_lock(hashtext(p_owner_clerk_id), hashtext(p_module));

  select *
    into current_state
    from amazon_module_alert_states
   where owner_clerk_id = p_owner_clerk_id
     and module = p_module
   for update;

  if not found then
    should_alert := p_is_degraded and p_failure_category is not null;
    insert into amazon_module_alert_states (
      owner_clerk_id, module, is_degraded, failure_category,
      observed_latency_ms, degraded_samples, sample_window, evaluated_at, last_alert_at
    ) values (
      p_owner_clerk_id, p_module, p_is_degraded, p_failure_category,
      p_observed_latency_ms, p_degraded_samples, p_sample_window, p_evaluated_at,
      case when should_alert then p_evaluated_at else null end
    );
    return should_alert;
  end if;

  should_alert := p_is_degraded
    and p_failure_category is not null
    and (
      not current_state.is_degraded
      or current_state.failure_category is distinct from p_failure_category
    );

  update amazon_module_alert_states
     set is_degraded = p_is_degraded,
         failure_category = case when p_is_degraded then p_failure_category else null end,
         observed_latency_ms = p_observed_latency_ms,
         degraded_samples = p_degraded_samples,
         sample_window = p_sample_window,
         evaluated_at = p_evaluated_at,
         last_alert_at = case
           when should_alert then p_evaluated_at
           else current_state.last_alert_at
         end
   where owner_clerk_id = p_owner_clerk_id
     and module = p_module;

  return should_alert;
end;
$$;