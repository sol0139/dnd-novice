// Адрес базы и публичный ключ Supabase.
// Оба значения не секретные: они и так уходят в браузер каждому посетителю,
// а данные защищают правила доступа (RLS) в самой базе.
// Секретный ключ (secret / service_role) сюда не кладём никогда.
window.APP_CONFIG = {
  supabaseUrl: "https://ebbmnaxywnovzuqdszdu.supabase.co",
  supabaseKey: "sb_publishable_yk9frCrSbo2RuWLIFrDWVw_hXuXkeD0"
};
