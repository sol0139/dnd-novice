-- Защита бесплатной базы (500 МБ на всё).
-- Один персонаж весит 4–16 КБ, поэтому даже 100 персонажей у каждого из 50 мастеров — около 80 МБ.

-- 1. Один персонаж — не больше 200 КБ. Сырые выгрузки LSS сюда не кладём, только итоговый лист.
alter table public.characters
  add constraint characters_data_size check (octet_length(data::text) <= 200000);

-- 2. У одного мастера — не больше 100 персонажей.
create or replace function public.limit_characters_per_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.characters c where c.owner_id = new.owner_id) >= 100 then
    raise exception 'Слишком много персонажей: у одного мастера до 100. Удали старых и попробуй снова.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_characters_per_owner() from public, anon, authenticated;
create trigger characters_limit before insert on public.characters
  for each row execute function public.limit_characters_per_owner();
