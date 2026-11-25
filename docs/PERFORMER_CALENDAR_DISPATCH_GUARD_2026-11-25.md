# #170: immediate dispatch reservation guard (draft)

Current jobs do not have a verified upper duration bound. Until scheduled dispatch and a reliable duration/buffer policy exist, an unbounded immediate job is not assigned to a performer with any non-expired confirmed reservation. This deliberately conservative intermediate rule is NOT the final calendar policy; it may reduce availability even when a reservation is far away. It must not be interpreted as actual current work or advertised to customers as a guarantee. Proposals, cancelled/completed and expired reservations do not block.

Candidate discovery, preferred invitations, queued calls, enlistment, direct acceptance, auction offers and selection (including auto-selection) check the reservation. Final write paths repeat the check under the performer profile row lock. A future reservation confirmation/transfer writer MUST acquire that same lock and check active orders. The current public API has no reservation writer and this change does not create one; direct fixture inserts are test-only.

No change to approved design, payment rules or actual presence. No merge/deploy until tests, two-party confirmation, scheduled dispatch, duration policy, lifecycle and manual acceptance are complete.

## Preview consistency

Customer nearby counters and cards, and the performer closer-colleague counter,
exclude the same non-expired confirmed intervals as immediate dispatch. Presence
(online) stays distinct from eligibility for another immediate job. Proposed,
cancelled, completed and expired intervals do not alone exclude a worker. No
future time guarantee, public calendar detail, or claim of physical work is
introduced by this change. The preview remains advisory; final assignment still
uses its transactional checks.

## Explicit order termination

A database trigger handles future explicit transitions of a linked order to
cancelled/completed in the same transaction as the order. Cancellation closes
only that order's open reservations; actual completion marks only the confirmed
appointment of the assigned performer completed, and closes unaccepted
alternatives as cancelled. The corresponding audit event is atomic. A rollback
restores both the order and reservation. No backfill of old rows, automatic
release after failed search, or reassignment-based cancellation is performed.
Existing order notifications and financial hooks remain authoritative. Linked
reservation notification delivery and review of historical inconsistent rows
remain open until the full planned-order workflow is integrated.
