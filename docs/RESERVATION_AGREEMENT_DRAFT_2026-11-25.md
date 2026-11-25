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

## Reschedule (internal draft)

The same confirmed row keeps its original reserved_span while pending move metadata
is proposed by the customer or selected/counteroffered by the performer. The
customer must confirm the exact current version. An atomic update replaces the
span without changing the reservation ID; exclusion violation rolls back all
changes and leaves the original reservation intact. Either party can withdraw
only the pending move, and cancelling the appointment clears pending metadata.
The audit retains both intervals and versions. Moves require original and new
start times in the future; handling late appointments is a separate workflow.
Still no HTTP routes, live notification delivery, linked order lifecycle or UI.

## Durable notifications (internal draft)

Every actual negotiation event atomically enqueues an intent for the other
participant, not the actor or unrelated accounts. A bounded concurrent worker
persists an inbox alert and acknowledges the intent in one transaction; retries
cannot duplicate the inbox. Superseded versions, expired pending proposals and
revoked recipient roles are marked obsolete. Push/realtime is best effort after
commit and only requests a refresh; it never includes personal details or an
unverified future time. The worker is NOT attached to the production scheduler
or public endpoints, because the planned-order lifecycle and fleet ACL are not
ready. Handling overdue confirmed records, escalation and delivery acceptance on
real Android devices remain separate work.

## Deadline sweep (internal draft)

At the requested/selected interval start, an unconfirmed proposal expires with
an explicit system cancellation reason and audit event. A pending move expires
when either the original or proposed start arrives; the confirmed original is
not silently cancelled. At the confirmed interval end, mark review_required_at
once, clear any now-unconfirmable move and notify both participants. No clock
transition marks work performed, paid or cancelled. System events and their two
notification intents commit with the row update; concurrent bounded workers
cannot emit duplicate expiry/review events. Only managed unlinked rows are swept.
No production scheduler or public route is enabled, and actual delayed arrival,
resolution of a past confirmed appointment, linked-order dispatch and payments
still require a separately agreed workflow. The existing immediate-dispatch
policy uses the reservation end time; a review marker is not proof of active work.
