/**
 * Explicitly gated checkout-independent HTTP endpoints for checkpoint evidence.
 * Disabled by default and prohibited on production traffic until the legal,
 * Android GPS provenance, retention and billing reviews are completed.
 *
 * IMPORTANT: these handlers do not execute any arrival/status or money action.
 */
import { z } from 'zod';
import type { Router, AuthedCtx } from './router.ts';
import { parse } from './router.ts';
import type { CheckpointEvidenceService } from '../services/checkpointEvidence.ts';

const uuid = z.string().uuid();
const key = z.string().regex(/^[a-zA-Z0-9._:-]{8,160}$/);
const explanation = z.string().trim().min(20).max(2000);
const approvalHash = z.string().regex(/^[0-9a-fA-F]{64}$/);

export function checkpointApiEnabled(): boolean {
  // Never enable in production by an accidental copied .env switch.
  // The isolated production-configured sandbox may still exercise the flow.
  return process.env.CHECKPOINT_EVIDENCE_API_ENABLED === 'true' &&
    (process.env.SANDBOX_INSTANCE === 'true' || process.env.NODE_ENV !== 'production');
}

export function registerCheckpointRoutes(r: Router, service: CheckpointEvidenceService): boolean {
  if (!checkpointApiEnabled()) return false;

  r.put('/api/orders/:id/checkpoint-plan', true, (c: AuthedCtx) => {
    const p = parse(z.object({
      requestKey: key.max(120), lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180), radiusM: z.number().int().min(50).max(500),
      requiresPass: z.boolean(), locationDescription: z.string().max(500).nullish(),
    }).strict(), c.body);
    return service.agreePlan(c.user, c.params.id, p);
  });

  r.get('/api/orders/:id/checkpoint', true,
    (c: AuthedCtx) => service.inspect(c.user, c.params.id));

  // Personal-data access: paginated, only the authenticated user's own GPS
  // and grant history; never routes of the client's other drivers.
  r.get('/api/me/checkpoint-privacy', true, (c: AuthedCtx) => {
    const q = parse(z.object({
      offset: z.coerce.number().int().min(0).max(100000).default(0),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }), {
      offset: c.query.get('offset') ?? undefined,
      limit: c.query.get('limit') ?? undefined,
    });
    return service.myCheckpointPrivacy(c.user, q.offset, q.limit);
  });



  // Separate time-limited permission. A single GPS message with a boolean
  // cannot silently create lasting tracking consent. Revocation is always
  // accepted for the original performer, including after order closure.
  r.post('/api/orders/:id/checkpoint/gps-consent', ['master', 'tow', 'service'],
    (c: AuthedCtx) => {
      const p = parse(z.object({
        eventKey: key, planId: uuid, action: z.enum(['granted','revoked']),
        durationMinutes: z.number().int().min(5).max(180).optional(),
      }).strict(), c.body);
      return service.gpsConsent(c.user, c.params.id, p);
    });

  r.post('/api/orders/:id/checkpoint/arrival', ['master', 'tow', 'service'], (c: AuthedCtx) => {
    const p = parse(z.object({
      requestKey: key, planId: uuid,
      gpsConsent: z.literal(true), explanation: z.string().max(2000).nullish(),
    }).strict(), c.body);
    return service.submitAttempt(c.user, c.params.id, p);
  });

  r.post('/api/checkpoint-attempts/:id/decision', true, (c: AuthedCtx) => {
    const p = parse(z.object({
      decision: z.enum(['corroborated', 'insufficient']), explanation,
    }).strict(), c.body);
    return service.decideAttempt(c.user, c.params.id, p);
  });

  r.post('/api/admin/checkpoint-plans/:id/pass-review', ['admin'], (c: AuthedCtx) => {
    const p = parse(z.object({
      eventKey: key, outcome: z.enum(['cleared', 'blocked']),
      evidenceRef: z.string().min(8).max(500), evidenceHash: approvalHash,
      explanation,
    }).strict(), c.body);
    return service.reviewPass(c.user, c.params.id, p);
  });

  r.get('/api/admin/checkpoint-attempts/:id/gps', ['admin'],
    (c: AuthedCtx) => service.inspectSnapshot(c.user, c.params.id));

  // Sandbox-only: preview counts first, then an explicit, audited and
  // idempotent request. No cron, no automatic deletion in production.
  r.get('/api/admin/checkpoint-gps/retention', ['admin'], (c: AuthedCtx) => {
    const q = parse(z.object({
      limit: z.coerce.number().int().min(1).max(1000).default(250),
    }), { limit: c.query.get('limit') ?? undefined });
    return service.retentionSweep(c.user, { limit: q.limit });
  });
  r.post('/api/admin/checkpoint-gps/retention', ['admin'], (c: AuthedCtx) => {
    const p = parse(z.object({
      eventKey: key, limit: z.number().int().min(1).max(1000).default(250),
      acknowledge: z.literal(true),
    }).strict(), c.body);
    return service.retentionSweep(c.user, { ...p, execute: true });
  });

  // No public API to delete summaries, rewrite decisions or override expiry.
  // This experimental retention interface requires a legal-hold/backup policy
  // before any enabling outside the disposable test sandbox.
  return true;
}
