-- Public arrival directions are separate from private service contact numbers.
alter table service_centers add column if not exists arrival_notes text not null default '';
