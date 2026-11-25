-- Non-billable performer recommendation. Customer approval does not create a
-- paid order, dispatch, bank hold or subscription. The next order remains
-- a separate contract and must be explicitly submitted by the fleet owner.
create table if not exists order_continuation_recommendations (
 id uuid primary key default gen_random_uuid(),
 source_order_id uuid not null references orders(id),
 client_id uuid not null references users(id),
 suggested_by uuid not null references users(id),
 target_kind text not null check (target_kind in ('tow','sto','master','ecu')),
 summary text not null,
 status text not null default 'pending' check(status in ('pending','approved','declined')),
 decided_by uuid references users(id),
 decided_at timestamptz,
 created_at timestamptz not null default now(),
 unique(source_order_id,target_kind)
);
create index if not exists order_continuation_recommendations_client
 on order_continuation_recommendations(client_id,created_at desc);
comment on table order_continuation_recommendations is
 'No-cost next-step suggestions. Only owner may approve search; quote and payment follow the separate linked order or STO booking.';

-- A booking created from a recommendation is linked to that exact decision;
-- repeat submissions cannot create two workshop bookings from one approval.
alter table service_bookings
 add column if not exists continuation_recommendation_id uuid
 references order_continuation_recommendations(id);
create unique index if not exists service_booking_recommendation_once
 on service_bookings(continuation_recommendation_id)
 where continuation_recommendation_id is not null;
