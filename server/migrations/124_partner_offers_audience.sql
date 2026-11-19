-- Dedicated legal editions for insurer and inspection roles.
-- Previously offers.audience accepted only client/performer/privacy.
-- This ALTER does not modify existing published versions or consent records.
alter table offers drop constraint if exists offers_audience_check;
alter table offers add constraint offers_audience_check
  check (audience in ('client','performer','privacy','insurer','inspection'));
