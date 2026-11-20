-- Attach an explicit owner-approved ECU recommendation to its technical
-- handoff. Legacy no-recommendation handoffs remain free and valid, with NULL.
-- Never infer fulfilment merely from matching source_order_id.
alter table ecu_handoffs
  add column if not exists continuation_recommendation_id uuid
    references order_continuation_recommendations(id);

create unique index if not exists ecu_handoffs_recommendation_once
  on ecu_handoffs(continuation_recommendation_id)
  where continuation_recommendation_id is not null;
