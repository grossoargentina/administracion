-- Envíos de logística por WhatsApp: aviso con plantilla → el técnico toca "Ver mi logística"
-- → recibe el texto completo → responde Confirmo / No puedo.
create table if not exists public.wa_envios (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  personal_id      integer references public.personal(id) on delete set null,
  nombre           text,
  evento           text,
  telefono         text not null,           -- número normalizado (wa_id), ej 5491112345678
  texto            text not null,           -- logística completa que se manda al tocar el botón
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','error','enviado','entregado','leido','vio_logistica','confirmo','no_puede')),
  error            text,
  wamid_aviso      text,
  wamid_logistica  text
);

create index if not exists wa_envios_telefono_idx on public.wa_envios (telefono, created_at desc);
create index if not exists wa_envios_wamid_aviso_idx on public.wa_envios (wamid_aviso);

alter table public.wa_envios enable row level security;
create policy solo_admin on public.wa_envios for all to authenticated
  using (public.es_admin()) with check (public.es_admin());
revoke all on public.wa_envios from anon;
grant select, insert, update, delete on public.wa_envios to authenticated;

-- Para ver los cambios de estado en vivo en la plataforma
alter publication supabase_realtime add table public.wa_envios;
