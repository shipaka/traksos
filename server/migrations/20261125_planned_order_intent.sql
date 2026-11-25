-- Internal planned-order intent, not a payable order or a reserved interval.
-- Require an actual fleet vehicle and an explicit owner's decision. Do not
-- reuse awaiting_owner on orders: its existing approval launches dispatch.
CREATE TABLE planned_order_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  service text NOT NULL CHECK(service IN ('electric','diag','air','autonomy','tyre','hydraulics','tow')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  request_key text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>=1),
  status text NOT NULL DEFAULT 'awaiting_owner' CHECK(status IN ('awaiting_owner','owner_allowed','rejected')),
  decision_at timestamptz,
  decided_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(created_by,request_key),
  CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '48 hours'),
  CHECK((status='awaiting_owner' AND decision_at IS NULL AND decided_by IS NULL)
     OR (status IN ('owner_allowed','rejected') AND decision_at IS NOT NULL
         AND decided_by IS NOT NULL AND decided_by=owner_id))
);
CREATE INDEX planned_order_intents_owner ON planned_order_intents(owner_id,status,starts_at);
CREATE TABLE planned_order_intent_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES planned_order_intents(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('requested','owner_allowed','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(intent_id,version,event_type)
);
