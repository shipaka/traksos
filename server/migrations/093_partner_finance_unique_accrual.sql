-- Exactly one original accrual per request, including under concurrent admin requests.
-- Corrections are separate reversal entries and cannot silently replace the original.
create unique index if not exists partner_finance_one_accrual_per_request
  on partner_finance_entries(request_id) where entry_type='accrual';
