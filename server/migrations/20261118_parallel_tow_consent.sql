-- Explicit owner consent and financial snapshot for an additional parallel tow.
-- Historical orders remain unchanged and their independent charges are preserved.
alter table orders add column if not exists parallel_consent jsonb;
comment on column orders.parallel_consent is 'Explicit 2nd tow acknowledgment, frozen quoted call-out, actor and source order; never automatic cross-stage hold';
