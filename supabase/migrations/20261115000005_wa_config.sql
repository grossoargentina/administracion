-- Número de WhatsApp configurable desde la base (para cambiar de número sin tocar secretos).
-- wa_config guarda datos no secretos (ids); el token va encriptado en Vault.
-- Si no hay nada configurado, las funciones usan los secretos de siempre (WHATSAPP_PHONE_ID / WHATSAPP_TOKEN).

create table if not exists public.wa_config (
  clave      text primary key,
  valor      text,
  updated_at timestamptz not null default now()
);
alter table public.wa_config enable row level security;
create policy solo_admin on public.wa_config for all to authenticated
  using (public.es_admin()) with check (public.es_admin());
revoke all on public.wa_config from anon;

-- Guarda (o reemplaza) un token en Vault. Solo lo usan las funciones del servidor.
create or replace function public.wa_guardar_token(p_nombre text, p_valor text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if p_nombre not in ('wa_token', 'wa_token_nuevo') then raise exception 'nombre no permitido'; end if;
  select id into v_id from vault.secrets where name = p_nombre;
  if v_id is null then
    perform vault.create_secret(p_valor, p_nombre, 'Token de WhatsApp Cloud API');
  else
    perform vault.update_secret(v_id, p_valor);
  end if;
end $$;

-- Credenciales activas (o las del número nuevo, para probar antes de activarlo)
create or replace function public.wa_credenciales(p_nuevo boolean default false)
returns table (phone_id text, waba_id text, token text)
language sql
security definer
set search_path = ''
as $$
  select
    (select valor from public.wa_config where clave = case when p_nuevo then 'phone_id_nuevo' else 'phone_id' end),
    (select valor from public.wa_config where clave = case when p_nuevo then 'waba_id_nuevo' else 'waba_id' end),
    (select decrypted_secret from vault.decrypted_secrets where name = case when p_nuevo then 'wa_token_nuevo' else 'wa_token' end);
$$;

revoke all on function public.wa_guardar_token(text, text) from public, anon, authenticated;
revoke all on function public.wa_credenciales(boolean) from public, anon, authenticated;
grant execute on function public.wa_guardar_token(text, text) to service_role;
grant execute on function public.wa_credenciales(boolean) to service_role;
