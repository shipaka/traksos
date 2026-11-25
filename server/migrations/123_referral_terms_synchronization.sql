-- Migration of the historical default referral policy (0.5% of order)
-- to the approved 10% of platform service fee. The changed calculation
-- lives in ReferralService; custom non-legacy rates are left untouched.
-- Previously saved settings lack clientSpendCapPct; SettingsService merges
-- the new 10% of order default automatically.
update settings
set value=jsonb_set(value,'{clientSharePct}','10'::jsonb,true),
    updated_at=now()
where key='referral'
  and value ? 'clientSharePct'
  and (value->>'clientSharePct')::numeric=0.5;
