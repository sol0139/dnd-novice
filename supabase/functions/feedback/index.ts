// Точка входа функции на Supabase. Вся логика — в handler.js, чтобы её можно было проверить без Supabase.
import { handle } from "./handler.js";

Deno.serve((req: Request) => handle(req, Deno.env.toObject()));
