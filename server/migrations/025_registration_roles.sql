-- Registration category is separate from live privilege checks.
alter table users add column if not exists registration_kind text;
-- Preserve legacy users without inventing an ownership status.
alter table users add constraint users_registration_kind_check
  check (registration_kind is null or registration_kind in
    ('owner','driver','master','tow','service','master_service','insurer'));
