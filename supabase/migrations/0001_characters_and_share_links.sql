-- Персонажи мастеров: весь лист персонажа лежит в data (наш формат novice-sheet)
create table public.characters (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  data        jsonb not null,
  share_slug  text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index characters_owner_idx on public.characters (owner_id);

-- Доступ: каждый мастер видит и меняет только своих персонажей
alter table public.characters enable row level security;
revoke all on public.characters from anon;

create policy "Мастер видит своих персонажей" on public.characters
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Мастер создаёт своих персонажей" on public.characters
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Мастер меняет своих персонажей" on public.characters
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Мастер удаляет своих персонажей" on public.characters
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- Дата последнего изменения обновляется сама
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger characters_touch before update on public.characters
  for each row execute function public.touch_updated_at();

-- Игрок открывает персонажа по короткой ссылке без входа.
-- Функция отдаёт ровно одного персонажа по его коду и не позволяет перебрать остальных.
create or replace function public.get_shared_character(slug text)
returns table (name text, data jsonb, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.name, c.data, c.updated_at
  from public.characters c
  where c.share_slug = slug
  limit 1;
$$;
revoke all on function public.get_shared_character(text) from public;
grant execute on function public.get_shared_character(text) to anon, authenticated;
