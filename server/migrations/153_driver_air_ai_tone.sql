-- Per-account preference for the future TrakSOS AI co-driver.
-- This is only a saved UI preference. No model or message reading is activated.
alter table community_profiles
  add column if not exists ai_tone text not null default 'road'
  check (ai_tone in ('straight','humor','road'));

comment on column community_profiles.ai_tone is
  'User-selected AI chat personality preview; future integration must honor safety overrides.';
