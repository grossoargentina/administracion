-- Seguridad: solo usuarios logueados y autorizados acceden a los datos.
-- Antes: la clave pública (anon) podía leer, modificar y borrar todas las tablas.
-- Requiere que la web mande el token de sesión (src/helpers.ts → authHeaders).

-- 1) Quién es administrador: email del token de Supabase Auth
create or replace function public.es_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = any (array['administracion@grossoarg.com']);
$$;

revoke all on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;

-- 2) Todas las tablas de public: RLS activado, sin políticas viejas, una sola política para admins
do $$
declare
  t record;
  p record;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', t.relname);

    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t.relname loop
      execute format('drop policy %I on public.%I', p.policyname, t.relname);
    end loop;

    -- Las tablas de respaldo quedan sin política: solo accesibles desde el panel de Supabase
    if t.relname not like '%backup%' then
      execute format(
        'create policy solo_admin on public.%I for all to authenticated using (public.es_admin()) with check (public.es_admin())',
        t.relname);
    end if;

    execute format('revoke all on public.%I from anon', t.relname);
  end loop;
end $$;

-- 3) Vistas: que respeten el RLS de las tablas (por defecto corren con permisos del dueño y lo saltean)
do $$
declare
  v record;
begin
  for v in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.relname);
    execute format('revoke all on public.%I from anon', v.relname);
  end loop;
end $$;

-- 4) La contraseña vieja guardada en texto plano ya no se usa (el login es con Google)
delete from public.config where clave = 'password_admin';
