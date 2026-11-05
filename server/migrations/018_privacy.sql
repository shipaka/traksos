-- Персональные данные: запрос на удаление (через 30 дней аккаунт обезличивается)
alter table users add column if not exists delete_requested_at timestamptz;
alter table users add column if not exists deleted_at timestamptz;
