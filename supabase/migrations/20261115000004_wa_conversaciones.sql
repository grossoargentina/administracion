-- Conversaciones de WhatsApp: mensajes entrantes y salientes en la misma tabla.
-- Responder = insertar una fila saliente con estado 'pendiente'; un trigger llama a la
-- función wa-responder, que la manda por la API de Meta y actualiza el estado.
-- Lo usan la sección Mensajes de la plataforma y Claude (cuando se le pide responder).

alter table public.whatsapp_mensajes
  add column if not exists direccion   text not null default 'entrante',
  add column if not exists estado      text,
  add column if not exists error       text,
  add column if not exists wamid       text,
  add column if not exists plantilla   boolean not null default false,
  add column if not exists enviado_por text;

alter table public.whatsapp_mensajes
  drop constraint if exists whatsapp_mensajes_direccion_check,
  add constraint whatsapp_mensajes_direccion_check check (direccion in ('entrante', 'saliente')),
  drop constraint if exists whatsapp_mensajes_estado_check,
  add constraint whatsapp_mensajes_estado_check
    check (estado is null or estado in ('pendiente','enviado','entregado','leido','error','fuera_de_ventana'));

create index if not exists whatsapp_mensajes_de_ts_idx on public.whatsapp_mensajes (de, "timestamp" desc);
create index if not exists whatsapp_mensajes_wamid_idx on public.whatsapp_mensajes (wamid);

-- Número argentino → formato de WhatsApp (549 + área + número), igual que send-whatsapp
create or replace function public.normalizar_tel(t text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare n text := regexp_replace(coalesce(t, ''), '\D', '', 'g');
begin
  if n = '' then return null; end if;
  if left(n, 2) = '00' then n := substr(n, 3); end if;
  if left(n, 1) = '0' then n := '54' || substr(n, 2); end if;
  if length(n) = 10 then n := '54' || n; end if;
  if length(n) = 12 and left(n, 2) = '54' then n := '549' || substr(n, 3); end if;
  return n;
end $$;

-- Una fila por conversación, con el nombre del contacto si está cargado en personal o clientes
create or replace view public.wa_contactos
with (security_invoker = true) as
with agenda as (
  select public.normalizar_tel(telefono) tel, trim(coalesce(nombre, '') || ' ' || coalesce(apellido, '')) nombre, 'Personal'::text tipo, id ref_id
  from public.personal where telefono is not null
  union all
  select public.normalizar_tel(telefono), nombre, 'Cliente', id
  from public.clientes where telefono is not null
),
ultimo as (
  select distinct on (de) de, mensaje, "timestamp", direccion
  from public.whatsapp_mensajes where de is not null
  order by de, "timestamp" desc
),
perfil as (
  select distinct on (de) de, nombre
  from public.whatsapp_mensajes where direccion = 'entrante'
  order by de, "timestamp" desc
),
stats as (
  select de,
         count(*) filter (where direccion = 'entrante' and not coalesce(leido, false)) no_leidos,
         max("timestamp") filter (where direccion = 'entrante') ultimo_entrante_at
  from public.whatsapp_mensajes group by de
)
select u.de                                   as telefono,
       coalesce(a.nombre, p.nombre, u.de)     as nombre,
       a.tipo                                 as tipo,
       a.ref_id                               as ref_id,
       p.nombre                               as nombre_whatsapp,
       u.mensaje                              as ultimo_mensaje,
       u.direccion                            as ultima_direccion,
       u."timestamp"                          as ultimo_at,
       coalesce(s.no_leidos, 0)               as no_leidos,
       s.ultimo_entrante_at,
       coalesce(s.ultimo_entrante_at > now() - interval '24 hours', false) as ventana_abierta
from ultimo u
left join perfil p on p.de = u.de
left join stats s on s.de = u.de
left join lateral (select * from agenda where agenda.tel = u.de limit 1) a on true;

revoke all on public.wa_contactos from anon;
grant select on public.wa_contactos to authenticated;

-- Al insertar un saliente pendiente, mandarlo (la clave interna está en Vault)
create or replace function public.wa_despachar_saliente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url     := 'https://mitosihorpjmrosdxqbt.supabase.co/functions/v1/wa-responder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_cron_key')
    ),
    body    := jsonb_build_object('id', new.id),
    timeout_milliseconds := 30000
  );
  return new;
end $$;

revoke all on function public.wa_despachar_saliente() from public, anon, authenticated;

drop trigger if exists wa_despachar_saliente on public.whatsapp_mensajes;
create trigger wa_despachar_saliente
  after insert on public.whatsapp_mensajes
  for each row
  when (new.direccion = 'saliente' and new.estado = 'pendiente')
  execute function public.wa_despachar_saliente();

-- Conversación en vivo en la plataforma
do $$ begin
  alter publication supabase_realtime add table public.whatsapp_mensajes;
exception when duplicate_object then null; end $$;
