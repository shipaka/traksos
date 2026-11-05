-- Распорядок исполнителя: рабочие дни, часы выездов, «на телефоне» до…; ручной выход на линию вне графика — до конца дня
alter table performer_profiles add column if not exists schedule jsonb;
alter table performer_profiles add column if not exists off_schedule_until timestamptz;
