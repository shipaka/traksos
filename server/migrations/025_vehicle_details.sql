-- Optional vehicle identification and configuration details for future parts matching.
-- VIN is a hint, not a guarantee: engines and assemblies can be replaced.
alter table vehicles add column if not exists vin text;
alter table vehicles add column if not exists engine text;
alter table vehicles add column if not exists configuration_notes text;

comment on column vehicles.vin is 'Optional vehicle identification number; do not assume original configuration';
comment on column vehicles.engine is 'Optional current engine designation, may differ from VIN specification';
comment on column vehicles.configuration_notes is 'Owner-provided notes about replacements or nonstandard vehicle configuration';
