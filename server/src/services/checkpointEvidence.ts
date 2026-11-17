/**
 * Checkpoint arrival evidence repository. Sandbox HTTP integration is
 * feature-gated and must never enable billing or production location capture.
 * These operations never mutate orders, GPS history, payments, waiting-time
 * billing, performer ratings, or pass documents.
 */
import { createHash } from 'node:crypto';
import type { Db, Queryable } from '../db/index.ts';
import { bad, conflict, forbidden, notFound, HttpError, type AuthUser } from '../http/router.ts';
import {
  assertCheckpointPlan, evaluateCheckpoint, sampledSnapshot,
  type CheckpointPlan, type ObservedPosition,
} from './checkpointEvidenceCore.ts';

const ACTIVE = new Set(['accepted', 'en_route']);
const KEY = /^[a-zA-Z0-9._:-]{8,160}$/;
const HASH = /^[a-fA-F0-9]{64}$/;

export interface PlanInput {
  requestKey: string;
  lat: number;
  lng: number;
  radiusM: number;
  requiresPass: boolean;
  locationDescription?: string | null;
}
export interface PassReviewInput {
  eventKey: string;
  outcome: 'cleared' | 'blocked';
  evidenceRef: string;
  evidenceHash: string;
  explanation: string;
}
export interface AttemptInput {
  requestKey: string;
  /** Exact immutable agreed gate plan, protects against old-app submissions. */
  planId: string;
  /** Affirmative order-scoped permission for a location proof snapshot. */
  gpsConsent: true;
  explanation?: string | null;
}
export interface DecisionInput {
  decision: 'corroborated' | 'insufficient';
  explanation: string;
}
/** Consent is for a single immutable plan, never a standing GPS permission. */
export interface GpsConsentInput {
  eventKey: string;
  planId: string;
  action: 'granted' | 'revoked';
  durationMinutes?: number;
}
export interface AttemptRow {
  id: string;
  plan_id: string;
  order_id: string;
  performer_id: string;
  outcome: string;
  evaluation: Record<string, unknown>;
  created_at: Date | string;
}

const normalize = (value: string) => value.trim();
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
function assertKey(key: string, max = 160) {
  if (typeof key !== 'string' || key.length > max || !KEY.test(key)) throw bad('checkpoint_bad_key', 'Нужен уникальный ключ запроса из 8–160 допустимых символов');
}
function assertExplanation(s: string, min = 20) {
  if (typeof s !== 'string' || s.trim().length < min || s.length > 2000) {
    throw bad('checkpoint_need_reason', 'Нужно подробное пояснение от 20 до 2000 символов');
  }
}
function isAdmin(a: AuthUser): boolean { return !!a?.roles?.includes('admin'); }
function isClient(actor: AuthUser, order: any): boolean {
  // A driver can only view an order THEY created. Sharing owner_id must
  // never grant access to other drivers' orders in the same fleet.
  return order.client_id === actor.id || order.created_by === actor.id;
}
async function audit(q: Queryable, actor: AuthUser, action: string, target: string, data: object = {}) {
  await q.query('insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
    [actor.id, action, target, data]);
}
function requireAssigned(order: any, actor: AuthUser) {
  if (order.performer_id !== actor.id) throw forbidden('Исполнитель не назначен на эту заявку');
}
function requireClient(order: any, actor: AuthUser) {
  if (!isClient(actor, order)) throw forbidden('Точку КПП подтверждает заказчик');
}
function ensureActive(order: any) {
  if (!ACTIVE.has(order.status)) throw conflict('checkpoint_not_en_route', 'КПП оформляют до фактического прибытия и завершения заявки');
}
function planShape(row: any, passState: CheckpointPlan['passState']): CheckpointPlan {
  return {
    orderId: row.order_id, performerId: row.performer_id,
    lat: Number(row.checkpoint_lat), lng: Number(row.checkpoint_lng),
    radiusM: Number(row.radius_m), passState,
    clientApprovedAt: new Date(row.client_approved_at).toISOString(),
  };
}
function planPayload(input: PlanInput) {
  return [
    input.lat, input.lng, input.radiusM, input.requiresPass,
    normalize(input.locationDescription ?? ''),
  ];
}
function renderAttempt(row: any) {
  return {
    id: row.id, planId: row.plan_id, orderId: row.order_id,
    outcome: row.outcome, evaluation: row.evaluation,
    createdAt: new Date(row.created_at).toISOString(),
    startBilling: false as const,
  };
}

export class CheckpointEvidenceService {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  /**
   * Append-only consent that is bound to one plan, one performer and a strict
   * expiry. Revocation takes effect on all new location writes and attempts.
   *
   * Serialize with the order row lock AND with GPS telemetry's advisory lock:
   * location ingest locks performer profile -> advisory lock; this method locks
   * order -> advisory lock; neither waits for the other's profile/order row.
   */
  async gpsConsent(actor: AuthUser, orderId: string, input: GpsConsentInput) {
    assertKey(input.eventKey);
    if (!['granted','revoked'].includes(input.action)) throw bad('checkpoint_consent_action');
    if (input.action === 'granted') {
      if (!Number.isInteger(input.durationMinutes) ||
          input.durationMinutes! < 5 || input.durationMinutes! > 180) {
        throw bad('checkpoint_consent_duration', 'Согласие на GPS: от 5 до 180 минут');
      }
    } else if (input.durationMinutes !== undefined) {
      throw bad('checkpoint_consent_duration', 'Отзыв согласия не имеет срока');
    }
    const duration = input.action === 'granted' ? input.durationMinutes! : null;
    const digest = sha(JSON.stringify([input.planId, input.action, duration]));
    return this.db.tx(async (q) => {
      const order = await q.one<any>(
        'select id,performer_id,status from orders where id=$1 for update', [orderId]);
      if (!order) throw notFound('Заявка не найдена');
      const plan = await q.one<any>(
        'select id,performer_id,order_id from checkpoint_evidence_plans where id=$1 and order_id=$2',
        [input.planId, orderId]);
      if (!plan) throw notFound('План КПП не найден');
      if (plan.performer_id !== actor.id) throw forbidden('Согласие GPS даёт только назначенный специалист');
      await q.query('select pg_advisory_xact_lock(712021,hashtext($1::text))', [plan.id]);
      const old = await q.one<any>(
        'select * from checkpoint_gps_consent_events where plan_id=$1 and event_key=$2',
        [plan.id, input.eventKey]);
      const current = async () => q.one<any>(
        'select action,expires_at from checkpoint_gps_consent_events where plan_id=$1 ' +
        'order by seq desc limit 1', [plan.id]);
      const response = (event: any, latest: any, reused: boolean) => ({
        eventId: String(event.seq), planId: plan.id, action: event.action, reused,
        active: latest?.action === 'granted' &&
          new Date(latest.expires_at).getTime() > this.now().getTime(),
        expiresAt: latest?.action === 'granted' ? new Date(latest.expires_at).toISOString() : null,
      });
      if (old) {
        if (old.request_hash !== digest) throw conflict('checkpoint_consent_key_changed',
          'Ключ согласия уже использован с другими условиями');
        return response(old, await current(), true);
      }
      if (input.action === 'granted') {
        requireAssigned(order, actor);
        ensureActive(order);
        const latestPlan = await q.one<any>(
          'select id from checkpoint_evidence_plans where order_id=$1 order by version desc limit 1',
          [orderId]);
        if (latestPlan?.id !== plan.id) throw conflict('checkpoint_plan_outdated',
          'Новая версия КПП требует отдельного согласия на GPS');
      }
      const expires = duration == null ? null :
        new Date(this.now().getTime() + duration * 60_000).toISOString();
      const event = await q.one<any>(
        'insert into checkpoint_gps_consent_events ' +
        '(plan_id,order_id,performer_id,event_key,request_hash,action,duration_minutes,expires_at) ' +
        'values($1,$2,$3,$4,$5,$6,$7,$8) returning *',
        [plan.id,orderId,actor.id,input.eventKey,digest,input.action,duration,expires],
      );
      await audit(q,actor,'checkpoint.gps_consent_'+input.action,plan.id,
        { orderId, eventSeq: String(event.seq), durationMinutes: duration });
      return response(event,event,false);
    });
  }

  /** Immutable client-approved gate plan; later changes create new versions. */
  async agreePlan(actor: AuthUser, orderId: string, input: PlanInput) {
    assertKey(input.requestKey, 120);
    const description = normalize(input.locationDescription ?? '');
    if (description.length > 500) throw bad('checkpoint_description', 'Слишком длинное описание КПП');
    if (typeof input.requiresPass !== 'boolean') throw bad('checkpoint_pass', 'Нужно указать необходимость пропуска');
    try {
      assertCheckpointPlan({
        orderId, performerId: 'validated-on-server', lat: input.lat, lng: input.lng,
        radiusM: input.radiusM, passState: input.requiresPass ? 'pending' : 'not_required',
        clientApprovedAt: this.now().toISOString(),
      });
    } catch (err) { throw bad('checkpoint_coordinates', (err as Error).message); }
    const digest = sha(JSON.stringify(planPayload(input)));

    return this.db.tx(async (q) => {
      const order = await q.one<any>('select * from orders where id=$1 for update', [orderId]);
      if (!order) throw notFound('Заявка не найдена');
      requireClient(order, actor);
      if (!order.performer_id) throw conflict('checkpoint_unassigned', 'Исполнитель не назначен');
      const prevKey = await q.one<any>(
        'select * from checkpoint_evidence_plans where order_id=$1 and plan_key=$2',
        [orderId, input.requestKey]);
      if (prevKey) {
        if (prevKey.request_hash !== digest || prevKey.performer_id !== order.performer_id) {
          throw conflict('checkpoint_key_changed', 'Повторный ключ с другим согласованным КПП');
        }
        return { planId: prevKey.id, version: Number(prevKey.version), reused: true,
          passState: prevKey.requires_pass ? 'pending' : 'not_required' };
      }
      ensureActive(order);
      const latest = await q.one<any>(
        'select * from checkpoint_evidence_plans where order_id=$1 order by version desc limit 1',
        [orderId]);
      const version = latest ? Number(latest.version) + 1 : 1;
      const row = await q.one<any>(
        'insert into checkpoint_evidence_plans ' +
        '(order_id,performer_id,plan_key,version,supersedes_id,checkpoint_lat,checkpoint_lng,' +
        'radius_m,requires_pass,location_description,approved_by,client_approved_at,request_hash) ' +
        'values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *',
        [orderId, order.performer_id, input.requestKey, version, latest?.id ?? null,
          input.lat, input.lng, input.radiusM, input.requiresPass, description || null,
          actor.id, this.now().toISOString(), digest],
      );
      await audit(q, actor, 'checkpoint.plan_agreed', row.id,
        { orderId, version, requiresPass: input.requiresPass });
      return { planId: row.id as string, version, reused: false,
        passState: input.requiresPass ? 'pending' : 'not_required' };
    });
  }

  /**
   * Administrative manual review of pass access. The proof is a reference to
   * external evidence and must be verified by an operator; the SHA alone
   * cannot verify the legal validity of a consent/document.
   */
  async reviewPass(actor: AuthUser, planId: string, input: PassReviewInput) {
    if (!isAdmin(actor)) throw forbidden('Проверять пропуск может только администратор');
    assertKey(input.eventKey);
    assertExplanation(input.explanation);
    if (!HASH.test(input.evidenceHash) ||
      !input.evidenceRef || input.evidenceRef.length < 8 || input.evidenceRef.length > 500) {
      throw bad('checkpoint_pass_evidence', 'Требуется защищённая ссылка на доказательство и SHA-256');
    }
    if (!['cleared','blocked'].includes(input.outcome)) throw bad('checkpoint_pass_decision');
    const digest = input.evidenceHash.toLowerCase();

    return this.db.tx(async (q) => {
      const plan = await q.one<any>('select * from checkpoint_evidence_plans where id=$1 for update', [planId]);
      if (!plan) throw notFound('План КПП не найден');
      const old = await q.one<any>('select * from checkpoint_pass_reviews where event_key=$1', [input.eventKey]);
      if (old) {
        if (old.plan_id !== planId || old.outcome !== input.outcome || old.evidence_ref !== input.evidenceRef ||
          old.evidence_hash !== digest || old.explanation !== input.explanation.trim()) {
          throw conflict('checkpoint_pass_key_changed', 'Ключ проверки пропуска повторён с другими данными');
        }
        return { reviewId: old.id, outcome: old.outcome, reused: true };
      }
      const latestPlan = await q.one<any>(
        'select id from checkpoint_evidence_plans where order_id=$1 order by version desc limit 1',
        [plan.order_id]);
      if (latestPlan?.id !== planId) throw conflict('checkpoint_plan_superseded', 'Для КПП уже согласована новая точка');
      const row = await q.one<any>(
        'insert into checkpoint_pass_reviews ' +
        '(plan_id,event_key,outcome,evidence_ref,evidence_hash,explanation,reviewed_by) ' +
        'values($1,$2,$3,$4,$5,$6,$7) returning id,outcome',
        [planId, input.eventKey, input.outcome, input.evidenceRef, digest,
          input.explanation.trim(), actor.id],
      );
      await audit(q, actor, 'checkpoint.pass_reviewed', planId, {
        orderId: plan.order_id, outcome: input.outcome, reviewId: row.id,
      });
      return { reviewId: row.id, outcome: row.outcome, reused: false };
    });
  }

  /**
   * On-demand, consented evidence snapshot from existing SERVER-collected
   * accepted GPS history. Device timestamps/estimates are never substituted.
   */
  async submitAttempt(actor: AuthUser, orderId: string, input: AttemptInput) {
    assertKey(input.requestKey);
    if (input.gpsConsent !== true) throw forbidden('Нужно разрешение исполнителя на фиксацию GPS для заявки');
    const explanation = (input.explanation ?? '').trim();
    if (explanation.length > 2000) throw bad('checkpoint_explanation', 'Слишком длинное пояснение');
    const bodyHash = sha(JSON.stringify([input.planId, explanation, true]));
    return this.db.tx(async (q) => {
      const order = await q.one<any>('select * from orders where id=$1 for update', [orderId]);
      if (!order) throw notFound('Заявка не найдена');
      requireAssigned(order, actor);
      const plan = await q.one<any>(
        'select * from checkpoint_evidence_plans where order_id=$1 order by version desc limit 1',
        [orderId]);
      if (!plan || plan.id !== input.planId || plan.performer_id !== actor.id) {
        throw conflict('checkpoint_plan_outdated', 'Нет актуального согласованного КПП');
      }
      const old = await q.one<any>(
        'select * from checkpoint_arrival_attempts where plan_id=$1 and request_key=$2',
        [plan.id, input.requestKey]);
      if (old) {
        if (old.request_hash !== bodyHash) throw conflict('checkpoint_attempt_key_changed', 'Повтор запроса с другими данными');
        return { ...renderAttempt(old), reused: true };
      }
      ensureActive(order);
      const consent = await q.one<any>(
        'select seq,action,expires_at from checkpoint_gps_consent_events ' +
        'where plan_id=$1 order by seq desc limit 1', [plan.id]);
      if (!consent || consent.action !== 'granted' ||
          new Date(consent.expires_at).getTime() <= this.now().getTime()) {
        throw forbidden('Согласие на GPS для этого КПП не дано, истекло или отозвано');
      }
      // An idempotent replay returns above even at the rate limit. Unique
      // new submissions are capped while the order row lock serializes races.
      const count = await q.one<{ n: number }>(
        'select count(*)::int as n from checkpoint_arrival_attempts ' +
        'where order_id=$1 and performer_id=$2 and created_at >= $3',
        [orderId, actor.id, new Date(this.now().getTime() - 15 * 60_000).toISOString()],
      );
      if (Number(count?.n ?? 0) >= 8) {
        throw new HttpError(429, 'checkpoint_rate_limited',
          'Слишком много попыток фиксации КПП за 15 минут');
      }
      const review = plan.requires_pass
        ? await q.one<any>(
          'select outcome from checkpoint_pass_reviews where plan_id=$1 order by recorded_at desc,id desc limit 1',
          [plan.id]) : null;
      const passState: CheckpointPlan['passState'] = plan.requires_pass
        ? review?.outcome === 'cleared' ? 'manually_cleared' : 'pending'
        : 'not_required';
      const now = this.now();
      const gpsRows = await q.query<any>(
        'select lat,lng,received_at,accuracy_m,gps_source,mock_location,accepted ' +
        'from performer_route_samples where order_id=$1 and performer_id=$2 ' +
        'and accepted=true and checkpoint_consent=true and checkpoint_plan_id=$3 ' +
        'and checkpoint_consent_seq=$4 and received_at >= $5 and received_at <= $6 ' +
        'order by received_at desc limit 200',
        [orderId, actor.id, plan.id, String(consent.seq),
          new Date(now.getTime() - 10 * 60_000).toISOString(), now.toISOString()],
      );
      const positions: ObservedPosition[] = gpsRows.reverse().map((r) => ({
        lat: Number(r.lat), lng: Number(r.lng),
        receivedAt: new Date(r.received_at).toISOString(),
        accuracyM: r.accuracy_m == null ? null : Number(r.accuracy_m),
        source: r.gps_source ?? 'unknown',
        mockLocation: !!r.mock_location,
        accepted: !!r.accepted,
      }));
      const snapshot = sampledSnapshot(positions, now);
      const evaluated = evaluateCheckpoint(planShape(plan, passState), snapshot, now, !!explanation);
      const sampleDigest = sha(JSON.stringify(snapshot));
      const row = await q.one<any>(
        'insert into checkpoint_arrival_attempts ' +
        '(plan_id,order_id,performer_id,request_key,request_hash,explanation,outcome,' +
        'evaluation,sample_digest,sample_count) ' +
        'values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) returning *',
        [plan.id, orderId, actor.id, input.requestKey, bodyHash, explanation || null,
          evaluated.outcome, JSON.stringify(evaluated), sampleDigest, snapshot.length],
      );
      await q.query(
        'insert into checkpoint_arrival_sample_snapshots(attempt_id,sample_snapshot) values($1,$2::jsonb)',
        [row.id, JSON.stringify(snapshot)],
      );
      await audit(q, actor, 'checkpoint.arrival_attempted', row.id, {
        orderId, outcome: evaluated.outcome, sampleCount: snapshot.length,
        reasonCodes: evaluated.reasons,
      });
      return { ...renderAttempt(row), reused: false };
    });
  }

  /**
   * Independent explicit confirmation by order owner or administrator.
   * This is a review result ONLY. Does not advance "arrived", trigger a
   * timer, charge a client, or sanction a performer.
   */
  async decideAttempt(actor: AuthUser, attemptId: string, input: DecisionInput) {
    if (!['corroborated','insufficient'].includes(input.decision)) throw bad('checkpoint_decision');
    assertExplanation(input.explanation);
    return this.db.tx(async (q) => {
      const attempt = await q.one<any>('select * from checkpoint_arrival_attempts where id=$1 for update', [attemptId]);
      if (!attempt) throw notFound('GPS-подтверждение не найдено');
      const order = await q.one<any>('select client_id,created_by from orders where id=$1', [attempt.order_id]);
      if (!isAdmin(actor) && !isClient(actor, order)) throw forbidden('Проверка доступна заказчику и администратору');
      const existing = await q.one<any>(
        'select * from checkpoint_arrival_decisions where attempt_id=$1', [attemptId]);
      if (existing) {
        if (existing.decision !== input.decision ||
          existing.explanation !== input.explanation.trim()) {
          throw conflict('checkpoint_already_decided', 'Решение уже записано; используйте отдельную процедуру спора');
        }
        return { decisionId: existing.id, decision: existing.decision, reused: true, startBilling: false };
      }
      const row = await q.one<any>(
        'insert into checkpoint_arrival_decisions(attempt_id,order_id,decision,explanation,decided_by) ' +
        'values($1,$2,$3,$4,$5) returning id,decision',
        [attemptId, attempt.order_id, input.decision, input.explanation.trim(), actor.id],
      );
      await audit(q, actor, 'checkpoint.arrival_reviewed', attemptId,
        { orderId: attempt.order_id, decision: input.decision, decisionId: row.id });
      return { decisionId: row.id, decision: row.decision, reused: false, startBilling: false };
    });
  }

  /** Administrator sees evidence; involved client only summaries (no raw GPS). */
  async inspect(actor: AuthUser, orderId: string) {
    const order = await this.db.one<any>(
      'select id,client_id,created_by,performer_id from orders where id=$1', [orderId]);
    if (!order) throw notFound('Заявка не найдена');
    if (!isAdmin(actor) && !isClient(actor, order) && actor.id !== order.performer_id) {
      throw forbidden('Доказательства не относятся к вашему заказу');
    }
    const admin = isAdmin(actor);
    const plans = await this.db.query<any>(
      'select id,version,checkpoint_lat,checkpoint_lng,radius_m,requires_pass,client_approved_at ' +
      'from checkpoint_evidence_plans where order_id=$1 order by version desc', [orderId]);
    const attempts = await this.db.query<any>(
      'select id,plan_id,outcome,evaluation,created_at ' +
      'from checkpoint_arrival_attempts where order_id=$1 order by created_at desc limit 100', [orderId]);
    const decisions = await this.db.query<any>(
      'select a.attempt_id,a.decision,a.decided_at from checkpoint_arrival_decisions a ' +
      'where a.order_id=$1 order by a.decided_at desc limit 100', [orderId]);
    const latestPlanId: string | null = plans[0]?.id ?? null;
    const lastConsent = latestPlanId ? await this.db.one<any>(
      'select action,expires_at from checkpoint_gps_consent_events where plan_id=$1 ' +
      'order by seq desc limit 1', [latestPlanId]) : null;
    const consent = {
      planId: latestPlanId,
      active: lastConsent?.action === 'granted' &&
        new Date(lastConsent.expires_at).getTime() > this.now().getTime(),
      expiresAt: lastConsent?.action === 'granted'
        ? new Date(lastConsent.expires_at).toISOString() : null,
    };
    const details = attempts.map((a) => {
      const ev = a.evaluation as Record<string, unknown>;
      return {
        id: a.id, planId: a.plan_id, outcome: a.outcome,
        createdAt: new Date(a.created_at).toISOString(),
        evaluation: admin || actor.id === order.performer_id ? ev : {
          outcome: ev.outcome, reasons: ev.reasons, evaluatedAt: ev.evaluatedAt,
          startBilling: false,
        },
      };
    });
    await audit(this.db, actor, 'checkpoint.evidence_viewed', orderId,
      { detailLevel: admin ? 'staff' : actor.id === order.performer_id ? 'performer' : 'client' });
    return { orderId, plans, attempts: details, decisions, gpsConsent: consent, startBilling: false };
  }

  /** Raw precise GPS is STAFF-ONLY, never returned to the client UI. */
  async inspectSnapshot(actor: AuthUser, attemptId: string) {
    if (!isAdmin(actor)) throw forbidden('Точная GPS-история доступна только администратору');
    const attempt = await this.db.one<any>(
      'select id,order_id,sample_digest,sample_count from checkpoint_arrival_attempts where id=$1',
      [attemptId]);
    if (!attempt) throw notFound('Попытка прибытия не найдена');
    const snapshot = await this.db.one<any>(
      'select sample_snapshot,expires_at from checkpoint_arrival_sample_snapshots ' +
      'where attempt_id=$1 and expires_at>$2',
      [attemptId,this.now().toISOString()]);
    await audit(this.db, actor, 'checkpoint.gps_snapshot_viewed', attemptId, {
      orderId: attempt.order_id, exists: !!snapshot,
    });
    return {
      attemptId, orderId: attempt.order_id, sampleCount: attempt.sample_count,
      sampleDigest: attempt.sample_digest, samples: snapshot?.sample_snapshot ?? null,
      expiresAt: snapshot?.expires_at ? new Date(snapshot.expires_at).toISOString() : null,
    };
  }

  /** Explicit privacy action; not a background task. Does not delete audit. */
  async purgeExpiredSnapshots(actor: AuthUser, limit = 250) {
    if (!isAdmin(actor)) throw forbidden('Только администратор может удалять истёкшие GPS-снимки');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw bad('checkpoint_purge_limit');
    return this.db.tx(async (q) => {
      const rows = await q.query<{ attempt_id: string }>(
        'delete from checkpoint_arrival_sample_snapshots ' +
        'where attempt_id in (select attempt_id from checkpoint_arrival_sample_snapshots ' +
        'where expires_at<$1 order by expires_at limit $2 for update skip locked) ' +
        'returning attempt_id',
        [this.now().toISOString(), limit],
      );
      await audit(q, actor, 'checkpoint.gps_snapshots_expired', 'checkpoint', { count: rows.length });
      return { purged: rows.length, summaryRetained: true };
    });
  }
}
