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

Explicit terminal transitions of existing linked orders now synchronize their
reservation state at the database boundary. This is not a writer for creating a
planned order. Legacy unlinked negotiations and historical rows are untouched;
no automatic cancellation on reassignment or failed search is introduced.

## Planned order intent and fleet permission (internal)

The planned intent is deliberately separate from orders.awaiting_owner, whose
existing approval launches immediate dispatch. An actual vehicle is required;
current owner/driver assignment and allowed service are checked under locks at
request and decision. Only the owner can allow a plan; all driver plans require
explicit owner permission regardless of estimated amount. A revoked driver or
newly forbidden service cannot be approved. Rejection can close an obsolete
request. Idempotency, exact version, time validation, atomic event history and
rollback are covered. Owner permission is NOT financial consent: no price,
reservation, order, payment, notifications or dispatch are created. Before
exposure, implement owner-visible pending list, reservation linkage, full
pricing/limits/current-offer validation at conversion, and final acceptance.
No production route or scheduler is enabled.

## Linking intent to tentative time negotiation

Only the owner of an explicitly permitted intent can initiate one tentative
proposal for that intent. The original vehicle, live driver assignment, allowed
service and matching performer role/specialty are rechecked at request and time
selection. A unique index and composite foreign key protect ownership and
prevent competing proposals for one intent. The existing unlinked API cannot
reuse the linked proposal key. The final confirm method deliberately rejects
intent-linked rows until a separately reviewed atomic checkout creates a real
order; the database also rejects a confirmed/completed linked intent without
an order. No public route, production scheduler, price or payment is enabled.
A replacement performer after cancellation requires a future explicit retry
workflow; no automatic reassignment is introduced.

## Preliminary cost acknowledgment

The selected reservation revision can receive an internal preliminary tariff
snapshot using the existing regional coverage guard, scheduled start's Moscow
night tariff and capped client fee (including the existing personal override).
It excludes labor duration, parts, waiting and any negotiated performer price.
Only the owner can acknowledge the exact current snapshot; a new version or
changed tariff requires a new preview. Acknowledgment is idempotent and is NOT
financial consent, booking confirmation or payment. Production payment remains
closed by the existing payment policy. Final checkout still requires current
offers, accepted actual price, fleet limits and atomic order/reservation linkage.
No HTTP routes or UI are enabled by this stage.
