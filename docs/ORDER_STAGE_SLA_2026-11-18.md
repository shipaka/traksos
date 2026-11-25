# Operational stage SLA & weak-link retry (18 November 2026)

DRAFT / DO NOT MERGE OR DEPLOY. Existing case PR #162 is a separate review.

- A once-per-minute monitor detects overdue searching (15 min, SOS 7 min), owner approval (30), accepted/not departed (20), en route (120), arrived (60), working (240), awaiting amount approval (120).
- The active auction is NOT interrupted; a truly orphaned search without an auction is handed back to the existing dispatch queue once.
- Stage timestamp is the timestamp of the actual transition. Incidents are unique by order + stage + start time, with persistent notifications in the same transaction, admin-only review and audit trail.
- A third table in the admin Demand section lists all overdue stages and review decisions. The separate recurrence table counts only manually confirmed executor stage incidents in a 30-day window. Three confirmed cases means investigation, not automatic punishment.
- Mobile/web new-order form sends one stable random Idempotency-Key for the same form after ambiguous failure. Only a SHA-256 form fingerprint and key are stored in sessionStorage for up to 24h, no address or vehicle description. The server already implements atomic order/hold deduplication.
- No automatic retry of any write, no automatic fines, escrow deduction, suspension or cancellation. Route ETA must be verified before tightening travel delays.
- The remaining roadmap includes photo/kilometer evidence, optional profile enrichment, executor invitations, concurrent multi-stage dispatch safeguards, owner/driver restricted workspace and full offline drafts; those are NOT delivered here.
- Release gates: test existing DB migration; prove one order and one hold for repeated key; verify two concurrent sweeps; run CI and Android smoke; verify private notifications, GPS, role scopes; do not update main or VPS before acceptance.
