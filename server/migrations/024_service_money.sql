-- Финансы рембазы: сколько комиссии погашено баллами и когда выплачено сервису
alter table service_bookings add column if not exists points integer not null default 0;
alter table service_bookings add column if not exists paid_out_at timestamptz;
