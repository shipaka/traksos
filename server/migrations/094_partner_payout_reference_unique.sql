-- A payment confirmation reference can only be recorded once for a given partner.
create unique index if not exists partner_finance_payout_reference_unique
on partner_finance_entries(partner_id,note) where entry_type='payout';
