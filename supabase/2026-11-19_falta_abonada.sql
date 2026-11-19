-- =====================================================================
-- Falta abonada + atestado médico anexado
-- Rodar UMA vez no Supabase: SQL Editor -> New query -> colar -> Run.
-- O script é idempotente: pode ser executado novamente sem estragar nada.
--
-- Regras:
--   * Novo status 'abonada': conta como PRESENÇA INTEGRAL no cálculo da
--     frequência, mas é exibido separadamente como "Falta abonada".
--   * O atestado (JPG, PNG, WEBP ou PDF, até 5 MB) fica no bucket PRIVADO
--     'atestados'. Apenas administradores (tabela admin_users) enviam,
--     abrem e removem. O snapshot público NUNCA recebe o arquivo nem o
--     motivo — apenas a contagem e o status de cada ensaio.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Validação do estado: aceita 'abonada' e confere o anexo.
-- ---------------------------------------------------------------------
create or replace function private.stamp_state()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.revision <> old.revision + 1 then
    raise exception 'Revisão inválida para esta operação.';
  end if;
  if pg_catalog.jsonb_typeof(new.state->'members') is distinct from 'array'
     or pg_catalog.jsonb_typeof(new.state->'rehearsals') is distinct from 'array'
     or pg_catalog.jsonb_array_length(new.state->'members') > 500
     or pg_catalog.jsonb_array_length(new.state->'rehearsals') > 10000
     or pg_catalog.pg_column_size(new.state) > 2000000 then
    raise exception 'Os registros enviados não atendem ao formato esperado.';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(new.state->'rehearsals') x(r)
    cross join lateral pg_catalog.jsonb_each(x.r->'attendance') a(member_id, entry)
    where a.entry->>'status' not in ('presente', 'parcial', 'justificada', 'abonada', 'falta', 'pendente')
      or a.entry->>'status' is null
  ) then
    raise exception 'Situação de frequência não reconhecida.';
  end if;
  -- Anexo só é aceito em falta abonada e precisa apontar para o bucket de atestados.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(new.state->'rehearsals') x(r)
    cross join lateral pg_catalog.jsonb_each(x.r->'attendance') a(member_id, entry)
    where a.entry ? 'attachment' and a.entry->'attachment' <> 'null'::jsonb and (
      a.entry->>'status' <> 'abonada'
      or pg_catalog.jsonb_typeof(a.entry->'attachment') <> 'object'
      or coalesce(a.entry->'attachment'->>'path', '') !~ '^[A-Za-z0-9_-]{1,80}/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'
      or coalesce(a.entry->'attachment'->>'type', '') not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
      or pg_catalog.char_length(coalesce(a.entry->'attachment'->>'name', '')) > 200
    )
  ) then
    raise exception 'Atestado anexado em formato inválido.';
  end if;
  new.updated_at := pg_catalog.now();
  new.state := pg_catalog.jsonb_set(new.state, '{revision}', pg_catalog.to_jsonb(new.revision), true);
  new.state := pg_catalog.jsonb_set(new.state, '{updatedAt}', pg_catalog.to_jsonb(new.updated_at), true);
  return new;
end;
$function$;

-- ---------------------------------------------------------------------
-- 2. Snapshot público: 'abonada' conta como presença e ganha o campo 'excused'.
-- ---------------------------------------------------------------------
create or replace function private.publish_frequency()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  m jsonb;
  r jsonb;
  entry jsonb;
  status text;
  mid text;
  c_present integer;
  c_partial integer;
  c_justified integer;
  c_excused integer;
  c_absent integer;
  c_pending integer;
  recorded integer;
  hist jsonb;
  people jsonb := '[]'::jsonb;
  latest jsonb := null;
  agenda jsonb := '[]'::jsonb;
  overall_present integer := 0;
  overall_partial integer := 0;
  overall_justified integer := 0;
  overall_excused integer := 0;
  overall_absent integer := 0;
  overall_pending integer := 0;
  rehearsals jsonb := coalesce(new.state->'rehearsals', '[]'::jsonb);
begin
  for m in select value from pg_catalog.jsonb_array_elements(coalesce(new.state->'members', '[]'::jsonb)) loop
    mid := m->>'id';
    c_present := 0; c_partial := 0; c_justified := 0; c_excused := 0; c_absent := 0; c_pending := 0;
    hist := '[]'::jsonb;
    for r in
      select value from pg_catalog.jsonb_array_elements(rehearsals)
      order by value->>'date', value->>'time'
    loop
      entry := r->'attendance'->mid;
      status := entry->>'status';
      case status
        when 'presente' then c_present := c_present + 1;
        when 'parcial' then c_partial := c_partial + 1;
        when 'justificada' then c_justified := c_justified + 1;
        when 'abonada' then c_excused := c_excused + 1;
        when 'falta' then c_absent := c_absent + 1;
        when 'pendente' then c_pending := c_pending + 1;
        else null;
      end case;
      if status is not null then
        -- Somente data, horário e status: motivo e atestado nunca são publicados.
        hist := hist || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'date', r->>'date', 'time', r->>'time', 'status', status
        ));
      end if;
    end loop;
    recorded := c_present + c_partial + c_justified + c_excused + c_absent;
    people := people || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id',mid,'name',m->>'name','active',coalesce((m->>'active')::boolean,true),
      'present',c_present,'partial',c_partial,'justified',c_justified,'excused',c_excused,
      'absent',c_absent,'pending',c_pending,'recorded',recorded,
      'frequency',case when recorded > 0 then pg_catalog.round((100.0*(c_present + c_excused + c_partial*0.5))/recorded,1) else null end,
      'history',hist
    ));
    overall_present := overall_present + c_present;
    overall_partial := overall_partial + c_partial;
    overall_justified := overall_justified + c_justified;
    overall_excused := overall_excused + c_excused;
    overall_absent := overall_absent + c_absent;
    overall_pending := overall_pending + c_pending;
  end loop;

  select pg_catalog.jsonb_build_object('date',v->>'date','time',v->>'time','location',v->>'location')
    into latest from pg_catalog.jsonb_array_elements(rehearsals) v
    order by v->>'date' desc, v->>'time' desc limit 1;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('date',v->>'date','time',v->>'time','location',v->>'location')
           order by v->>'date', v->>'time'), '[]'::jsonb)
    into agenda from pg_catalog.jsonb_array_elements(rehearsals) v;
  recorded := overall_present + overall_partial + overall_justified + overall_excused + overall_absent;

  insert into public.public_snapshot(id,revision,updated_at,payload)
  values (1,new.revision,new.updated_at,pg_catalog.jsonb_build_object(
    'members',people,'rehearsalCount',pg_catalog.jsonb_array_length(rehearsals),
    'lastRehearsal',latest,
    'schedule',agenda,
    'totals',pg_catalog.jsonb_build_object(
      'present',overall_present,'partial',overall_partial,
      'justified',overall_justified,'excused',overall_excused,'absent',overall_absent,
      'pending',overall_pending,'recorded',recorded,
      'frequency',case when recorded > 0 then pg_catalog.round(100.0*(overall_present + overall_excused + overall_partial*0.5)/recorded,1) else null end
    )
  ))
  on conflict(id) do update set
    revision=excluded.revision,
    updated_at=excluded.updated_at,
    payload=excluded.payload;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------
-- 3. Bucket PRIVADO para os atestados (5 MB, imagens e PDF).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('atestados', 'atestados', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- 4. Acesso aos atestados: somente administradores autenticados.
--    (Visitantes anônimos não têm nenhuma política => acesso negado.)
-- ---------------------------------------------------------------------
drop policy if exists "atestados: admin lê"     on storage.objects;
drop policy if exists "atestados: admin envia"  on storage.objects;
drop policy if exists "atestados: admin altera" on storage.objects;
drop policy if exists "atestados: admin remove" on storage.objects;

create policy "atestados: admin lê" on storage.objects
  for select to authenticated
  using (bucket_id = 'atestados'
         and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

create policy "atestados: admin envia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'atestados'
              and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

create policy "atestados: admin altera" on storage.objects
  for update to authenticated
  using (bucket_id = 'atestados'
         and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
  with check (bucket_id = 'atestados'
              and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

create policy "atestados: admin remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'atestados'
         and exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------
-- 5. Regenera o snapshot público já no formato novo (campo 'excused').
-- ---------------------------------------------------------------------
update public.app_state set revision = revision + 1 where id = 1;

commit;
