-- Столы: мастер собирает героев одной компании в одном месте и видит их сводку.
-- За стол садятся и герои из мастерской самого мастера, и герои игроков:
--   • игрок сам — по коду или ссылке-приглашению /t/КОД;
--   • мастер — по ссылке на лист игрока (/c/…), которую игрок ему прислал.
-- Хранятся только связи «стол — герой»: сами листы остаются у своих хозяев.

-- Код приглашения: 6 знаков без похожих друг на друга (нет 0/O, 1/I/L) — его легко продиктовать вслух.
create or replace function public.new_invite_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
begin
  for i in 1..6 loop
    code := code || substr(abc, 1 + floor(random() * length(abc))::int, 1);
  end loop;
  return code;
end;
$$;
revoke all on function public.new_invite_code() from public, anon;
grant execute on function public.new_invite_code() to authenticated;  -- нужна для значения по умолчанию при создании стола

-- Как игрок напишет код — маленькими буквами, с пробелом или дефисом — неважно
create or replace function public.clean_invite_code(code text)
returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;
revoke all on function public.clean_invite_code(text) from public, anon, authenticated;

create table public.game_tables (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  invite_code text not null unique default public.new_invite_code() check (invite_code ~ '^[A-HJKMNP-Z2-9]{6}$'),
  created_at  timestamptz not null default now()
);
create index game_tables_owner_idx on public.game_tables (owner_id);

create table public.table_seats (
  table_id     uuid not null references public.game_tables(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (table_id, character_id)
);
create index table_seats_character_idx on public.table_seats (character_id);

-- Доступ
alter table public.game_tables enable row level security;
alter table public.table_seats enable row level security;
revoke all on public.game_tables, public.table_seats from anon;
-- Мастер задаёт только название стола; хозяин и код ставятся сами, код меняется только функцией renew_table_code
revoke insert, update on public.game_tables from authenticated;
grant insert (name), update (name) on public.game_tables to authenticated;
revoke update on public.table_seats from authenticated;

create policy "Мастер видит свои столы" on public.game_tables
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Мастер создаёт свои столы" on public.game_tables
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Мастер меняет свои столы" on public.game_tables
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Мастер удаляет свои столы" on public.game_tables
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- Место за столом видят мастер стола и хозяин героя
create policy "Видят мастер стола и хозяин героя" on public.table_seats
  for select to authenticated using (
    exists (select 1 from public.game_tables t where t.id = table_id and t.owner_id = (select auth.uid()))
    or exists (select 1 from public.characters c where c.id = character_id and c.owner_id = (select auth.uid()))
  );
-- Напрямую мастер сажает только своих героев за свой стол; чужих — через приглашение или ссылку (функции ниже)
create policy "Мастер сажает своих героев" on public.table_seats
  for insert to authenticated with check (
    exists (select 1 from public.game_tables t where t.id = table_id and t.owner_id = (select auth.uid()))
    and exists (select 1 from public.characters c where c.id = character_id and c.owner_id = (select auth.uid()))
  );
-- Мастер убирает со своего стола кого угодно, игрок уводит из-за стола своего героя
create policy "Убирает мастер или хозяин героя" on public.table_seats
  for delete to authenticated using (
    exists (select 1 from public.game_tables t where t.id = table_id and t.owner_id = (select auth.uid()))
    or exists (select 1 from public.characters c where c.id = character_id and c.owner_id = (select auth.uid()))
  );

-- Защита бесплатной базы: до 20 столов у мастера и до 10 героев за столом
create or replace function public.limit_game_tables()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.game_tables t where t.owner_id = new.owner_id) >= 20 then
    raise exception 'Слишком много столов: у одного мастера до 20. Удали старые и попробуй снова.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_game_tables() from public, anon, authenticated;
create trigger game_tables_limit before insert on public.game_tables
  for each row execute function public.limit_game_tables();

create or replace function public.limit_table_seats()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.table_seats s where s.table_id = new.table_id) >= 10 then
    raise exception 'За столом уже 10 героев — больше не поместится.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_table_seats() from public, anon, authenticated;
create trigger table_seats_limit before insert on public.table_seats
  for each row execute function public.limit_table_seats();

-- Имя из Discord: видно за столом, кто мастер и чей герой. Только для функций ниже.
create or replace function public.nick_of(uid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    nullif(u.raw_user_meta_data #>> '{custom_claims,global_name}', ''),
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(u.raw_user_meta_data ->> 'name', ''),
    nullif(u.raw_user_meta_data ->> 'user_name', ''),
    'Без имени')
  from auth.users u where u.id = uid;
$$;
revoke all on function public.nick_of(uuid) from public, anon, authenticated;

-- Для сводки стола из листа берём только числа, без описаний способностей
create or replace function public.seat_card(d jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'class', d -> 'class',
    'race', jsonb_build_object('name', d #> '{race,name}'),
    'ac', d -> 'ac',
    'hp', jsonb_build_object('max', d #> '{hp,max}'),
    'speed', d -> 'speed',
    'abilities', d -> 'abilities',
    'skills', d -> 'skills',
    'expertise', d -> 'expertise',
    'proficiencyBonus', d -> 'proficiencyBonus',
    'passivePerception', d -> 'passivePerception',
    'halfProf', d -> 'halfProf',
    'spellcasting', case when jsonb_typeof(d -> 'spellcasting') = 'object'
      then jsonb_build_object('dc', d #> '{spellcasting,dc}', 'attack', d #> '{spellcasting,attack}') end,
    'languages', d -> 'languages',
    'saves', d -> 'saves');
$$;
revoke all on function public.seat_card(jsonb) from public, anon, authenticated;

-- Что за стол по коду: название, мастер, сколько героев. Видно и до входа — чтобы игрок понял, куда зовут.
create or replace function public.table_preview(code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'master', public.nick_of(t.owner_id),
    'isMaster', t.owner_id is not distinct from (select auth.uid()),
    'seats', (select count(*) from public.table_seats s where s.table_id = t.id),
    'seated', (select coalesce(jsonb_agg(s.character_id), '[]'::jsonb)
               from public.table_seats s join public.characters c on c.id = s.character_id
               where s.table_id = t.id and c.owner_id = (select auth.uid())))
  from public.game_tables t
  where t.invite_code = public.clean_invite_code(code);
$$;
revoke all on function public.table_preview(text) from public;
grant execute on function public.table_preview(text) to anon, authenticated;

-- Игрок сажает своего героя за стол по коду
create or replace function public.join_table(code text, hero uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.game_tables;
  n int;
begin
  if not exists (select 1 from public.characters c where c.id = hero and c.owner_id = (select auth.uid())) then
    raise exception 'Посадить за стол можно только своего героя.' using errcode = 'P0001';
  end if;
  select * into t from public.game_tables g where g.invite_code = public.clean_invite_code(code);
  if not found then
    raise exception 'Стол с таким кодом не найден. Попроси у мастера свежий код.' using errcode = 'P0001';
  end if;
  insert into public.table_seats (table_id, character_id) values (t.id, hero) on conflict do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('id', t.id, 'name', t.name, 'already', n = 0);
end;
$$;
revoke all on function public.join_table(text, uuid) from public, anon;
grant execute on function public.join_table(text, uuid) to authenticated;

-- Мастер сажает за свой стол героя по ссылке на лист (игрок прислал ссылку /c/…)
create or replace function public.seat_by_link(tbl uuid, slug text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  hid uuid;
  hname text;
  n int;
begin
  if not exists (select 1 from public.game_tables t where t.id = tbl and t.owner_id = (select auth.uid())) then
    raise exception 'Сажать героев по ссылке может только мастер этого стола.' using errcode = 'P0001';
  end if;
  select c.id, c.name into hid, hname from public.characters c where c.share_slug = slug;
  if not found then
    raise exception 'По этой ссылке героя нет. Проверь, что ссылка скопирована целиком.' using errcode = 'P0001';
  end if;
  insert into public.table_seats (table_id, character_id) values (tbl, hid) on conflict do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('name', hname, 'already', n = 0);
end;
$$;
revoke all on function public.seat_by_link(uuid, text) from public, anon;
grant execute on function public.seat_by_link(uuid, text) to authenticated;

-- Мои столы: где я мастер и где сидят мои герои
create or replace function public.my_tables()
returns jsonb language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) as uid),
  mine as (
    select t.id from public.game_tables t, me where t.owner_id = me.uid
    union
    select s.table_id from public.table_seats s join public.characters c on c.id = s.character_id, me where c.owner_id = me.uid
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'isMaster', t.owner_id = me.uid,
    'code', case when t.owner_id = me.uid then t.invite_code end,
    'master', public.nick_of(t.owner_id),
    'heroes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'mine', c.owner_id = me.uid) order by s.created_at), '[]'::jsonb)
               from public.table_seats s join public.characters c on c.id = s.character_id where s.table_id = t.id)
  ) order by t.created_at desc), '[]'::jsonb)
  from public.game_tables t join mine on mine.id = t.id, me;
$$;
revoke all on function public.my_tables() from public, anon;
grant execute on function public.my_tables() to authenticated;

-- Один стол целиком: герои и числа для сводки. Открыть может мастер стола и хозяин любого героя за ним.
-- Ссылку на лист видят только мастер стола и хозяин героя.
create or replace function public.get_table(tbl uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'isMaster', t.owner_id = me.uid,
    'code', case when t.owner_id = me.uid then t.invite_code end,
    'master', public.nick_of(t.owner_id),
    'heroes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'mine', c.owner_id = me.uid,
        'player', case when c.owner_id <> t.owner_id then public.nick_of(c.owner_id) end,
        'slug', case when t.owner_id = me.uid or c.owner_id = me.uid then c.share_slug end,
        'data', public.seat_card(c.data)) order by s.created_at), '[]'::jsonb)
      from public.table_seats s join public.characters c on c.id = s.character_id where s.table_id = t.id))
  from public.game_tables t, (select (select auth.uid()) as uid) me
  where t.id = tbl and (t.owner_id = me.uid or exists (
    select 1 from public.table_seats s join public.characters c on c.id = s.character_id
    where s.table_id = t.id and c.owner_id = me.uid));
$$;
revoke all on function public.get_table(uuid) from public, anon;
grant execute on function public.get_table(uuid) to authenticated;

-- Новый код приглашения: старые ссылки и код перестают работать
create or replace function public.renew_table_code(tbl uuid)
returns text language sql volatile security definer set search_path = '' as $$
  update public.game_tables set invite_code = public.new_invite_code()
  where id = tbl and owner_id = (select auth.uid())
  returning invite_code;
$$;
revoke all on function public.renew_table_code(uuid) from public, anon;
grant execute on function public.renew_table_code(uuid) to authenticated;
