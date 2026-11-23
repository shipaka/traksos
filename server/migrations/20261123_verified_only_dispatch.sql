-- Owner/driver can request verified partners only, across every dispatch stage.
alter table orders add column if not exists verified_only boolean not null default false;
