# #170: immediate dispatch reservation guard (draft)

Current jobs do not have a verified upper duration bound. Until scheduled dispatch and a reliable duration/buffer policy exist, an unbounded immediate job is not assigned to a performer with any non-expired confirmed reservation. This deliberately conservative intermediate rule is NOT the final calendar policy; it may reduce availability even when a reservation is far away. It must not be interpreted as actual current work or advertised to customers as a guarantee. Proposals, cancelled/completed and expired reservations do not block.

Candidate discovery, preferred invitations, queued calls, enlistment, direct acceptance, auction offers and selection (including auto-selection) check the reservation. Final write paths repeat the check under the performer profile row lock. A future reservation confirmation/transfer writer MUST acquire that same lock and check active orders. The current public API has no reservation writer and this change does not create one; direct fixture inserts are test-only.

No change to approved design, payment rules or actual presence. No merge/deploy until tests, two-party confirmation, scheduled dispatch, duration policy, lifecycle and manual acceptance are complete.
