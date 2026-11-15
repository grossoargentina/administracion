-- Recordatorio automático por WhatsApp el día anterior a cada jornada.
alter table public.wa_envios
  add column if not exists titulo     text,
  add column if not exists fechas     date[] not null default '{}',
  add column if not exists recordados date[] not null default '{}';

create index if not exists wa_envios_fechas_idx on public.wa_envios using gin (fechas);

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- La clave con la que el cron llama a la función wa-recordatorios se guarda en Vault
-- (se crea aparte con vault.create_secret(..., 'wa_cron_key'), no queda en el repositorio).

-- Todos los días a las 10:00 de Argentina (13:00 UTC)
select cron.schedule(
  'wa-recordatorios',
  '0 13 * * *',
  $$
  select net.http_post(
    url     := 'https://mitosihorpjmrosdxqbt.supabase.co/functions/v1/wa-recordatorios',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_cron_key')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
