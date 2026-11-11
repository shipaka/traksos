-- Conversation and customer-contact restrictions are scoped to each service booking.
create table if not exists service_booking_messages (
 id bigserial primary key,
 booking_id uuid not null references service_bookings(id) on delete cascade,
 sender_id uuid not null references users(id),
 body text not null check (char_length(body) between 1 and 2000),
 masked boolean not null default false,
 created_at timestamptz not null default now()
);
create index if not exists service_booking_messages_booking on service_booking_messages(booking_id,id);
create table if not exists service_contact_blocks (
 center_id uuid not null references service_centers(id) on delete cascade,
 client_id uuid not null references users(id) on delete cascade,
 reason text not null,
 created_by uuid not null references users(id),
 created_at timestamptz not null default now(),
 lifted_by uuid references users(id),
 lifted_at timestamptz,
 primary key(center_id,client_id)
);
