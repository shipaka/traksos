-- Exactly one origin: roadside order OR independent workshop booking.
alter table part_recommendations add column if not exists source_booking_id uuid references service_bookings(id);
alter table part_recommendations alter column source_order_id drop not null;
alter table part_recommendations add constraint part_recommendations_one_source
 check ((source_order_id is not null) <> (source_booking_id is not null));
create unique index if not exists part_recommendations_booking_once
 on part_recommendations(source_booking_id,lower(trim(brand)),lower(trim(article)))
 where source_booking_id is not null;
create index if not exists part_recommendations_booking_history on part_recommendations(source_booking_id,created_at desc,id);
