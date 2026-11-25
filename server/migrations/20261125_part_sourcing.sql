-- Separate sourcing workflow: requesting a quote does not order/reserve anything.
alter table part_recommendations add column if not exists sourcing_status text not null default 'not_requested' check(sourcing_status in ('not_requested','requested','resolved','unavailable'));
alter table part_recommendations add column if not exists sourcing_requested_at timestamptz;
alter table part_recommendations add column if not exists sourcing_updated_at timestamptz;
alter table part_recommendations add column if not exists sourcing_updated_by uuid references users(id);
alter table part_recommendations add column if not exists sourcing_note text;
create index if not exists part_recommendations_sourcing_queue on part_recommendations(sourcing_status,sourcing_requested_at,id);
