-- Stage 3 of PR #139. A bank-statement IMPORT is unverified until a human
-- checks actual bank evidence. This does not post payments or tax returns.
-- One immutable normalized CSV archive, its distinct bank transactions,
-- one-to-one event matches and audited, append-only match retractions.
create table if not exists shop_agency_bank_statements (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null check (length(btrim(bank_name)) between 2 and 160),
  account_ref text not null check (length(btrim(account_ref)) between 4 and 100),
  filename text not null check (length(filename) between 1 and 180),
  content_sha256 text not null unique check (content_sha256 ~ '^[0-9a-f]{64}$'),
  format text not null default 'normalized_csv_v1' check (format = 'normalized_csv_v1'),
  row_count integer not null check (row_count between 1 and 1000),
  csv_data bytea not null,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists shop_agency_bank_statement_date
  on shop_agency_bank_statements(created_at desc, id);

create table if not exists shop_agency_bank_rows (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references shop_agency_bank_statements(id) on delete restrict,
  account_ref text not null,
  line_no int not null check (line_no between 2 and 1001),
  transaction_ref text not null check (length(btrim(transaction_ref)) between 2 and 160),
  occurred_at timestamptz not null,
  direction text not null check (direction in ('in','out')),
  amount bigint not null check (amount > 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique(statement_id,line_no),
  -- A bank transaction may only be imported once per account even if multiple
  -- source CSV files overlap or have a different SHA.
  unique(account_ref, transaction_ref)
);
create index if not exists shop_agency_bank_rows_statement
  on shop_agency_bank_rows(statement_id, line_no);
create index if not exists shop_agency_bank_rows_time
  on shop_agency_bank_rows(account_ref, occurred_at);

create table if not exists shop_agency_bank_matches (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references shop_agency_bank_rows(id) on delete restrict,
  event_id uuid not null references shop_agency_events(id) on delete restrict,
  case_id uuid not null references shop_agency_cases(id) on delete restrict,
  note text not null check (length(btrim(note)) between 8 and 1000),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  -- Repeated matches after an explicit retraction are allowed; history is append-only.
  check (length(note) >= 8)
);
create index if not exists shop_agency_bank_matches_case
  on shop_agency_bank_matches(case_id, created_at desc);
create index if not exists shop_agency_bank_matches_event
  on shop_agency_bank_matches(event_id);

-- Corrections never update an original match; any wrong match remains visible
-- and gets a documented retraction. A new match can then be created.
create table if not exists shop_agency_bank_match_retractions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references shop_agency_bank_matches(id) on delete restrict,
  note text not null check (length(btrim(note)) between 8 and 1000),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);

drop trigger if exists agency_bank_statements_immutable on shop_agency_bank_statements;
create trigger agency_bank_statements_immutable
  before update or delete on shop_agency_bank_statements
  for each row execute function shop_agency_reject_mutation();
drop trigger if exists agency_bank_rows_immutable on shop_agency_bank_rows;
create trigger agency_bank_rows_immutable
  before update or delete on shop_agency_bank_rows
  for each row execute function shop_agency_reject_mutation();
drop trigger if exists agency_bank_matches_immutable on shop_agency_bank_matches;
create trigger agency_bank_matches_immutable
  before update or delete on shop_agency_bank_matches
  for each row execute function shop_agency_reject_mutation();
drop trigger if exists agency_bank_retractions_immutable on shop_agency_bank_match_retractions;
create trigger agency_bank_retractions_immutable
  before update or delete on shop_agency_bank_match_retractions
  for each row execute function shop_agency_reject_mutation();
