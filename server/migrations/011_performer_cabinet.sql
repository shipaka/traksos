-- Кабинет исполнителя по разделам: до трёх машин (одна — «сегодня на ней») и вопросы в поддержку по каждой операции
alter table performer_profiles add column if not exists cars jsonb not null default '[]';
update performer_profiles set cars = jsonb_build_array(car) where car is not null and cars = '[]'::jsonb;
alter table support_tickets add column if not exists ledger_entry_id bigint references ledger_entries(id) on delete set null;
