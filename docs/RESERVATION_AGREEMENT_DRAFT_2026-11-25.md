# #170: reservation negotiation core — internal draft

Managed unlinked rows have an agreement version and explicit participant decisions.
Client requests an exact UTC interval and a specific performer using an idempotency
key. Performer selects the interval or counters with a new interval and version.
Client confirms the exact current version. PostgreSQL overlap exclusion remains the
final authority; the profile row lock is shared with immediate accept/choose, and
confirmation checks actual active orders. Each successful change writes an audit
event in the same transaction. Cancellation releases only that negotiation.

No public HTTP endpoints are wired. These internal methods do not create or assign
an order, calculate duration/travel buffers, take money, publish availability,
deliver notifications, or authorize fleet drivers. Existing rows with version 0
are not upgraded into implied agreements. Before enabling this service, integrate
a planned-order model with order/vehicle ACL, owner/driver approval, immutable
pricing/offer terms, dispatch at the confirmed time, durable notifications, expiry,
and atomic reschedule retaining the original confirmed slot until replacement.
Current conservative rule blocks confirmation while an unbounded active order
exists. This is not the final duration policy. Do not deploy separately.
