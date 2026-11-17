/**
 * Sandbox-only integrity audit and explicit constraint validation for
 * historical checkpoint evidence. Never exports GPS or user IDs.
 * Does not mutate evidence, orders, payments, or performer permissions.
 */
import { createHash } from 'node:crypto';
import type { Db, Queryable } from '../db/index.ts';
import { bad, conflict, forbidden, type AuthUser } from '../http/router.ts';

const SCOPE_CHECKS = [
  {
    name: 'checkpoint_supersedes_same_order_fk',
    table: 'checkpoint_evidence_plans',
    countSql: 'select count(*)::int as n from checkpoint_evidence_plans p ' +
      'left join checkpoint_evidence_plans prior on prior.id=p.supersedes_id ' +
      'and prior.order_id=p.order_id ' +
      'where p.supersedes_id is not null and prior.id is null',
  },
  {
    name: 'checkpoint_consent_scope_fk',
    table: 'checkpoint_gps_consent_events',
    countSql: 'select count(*)::int as n from checkpoint_gps_consent_events e ' +
      'left join checkpoint_evidence_plans p on p.id=e.plan_id ' +
      'and p.order_id=e.order_id and p.performer_id=e.performer_id ' +
      'where p.id is null',
  },
  {
    name: 'checkpoint_attempt_scope_fk',
    table: 'checkpoint_arrival_attempts',
    countSql: 'select count(*)::int as n from checkpoint_arrival_attempts a ' +
      'left join checkpoint_evidence_plans p on p.id=a.plan_id ' +
      'and p.order_id=a.order_id and p.performer_id=a.performer_id ' +
      'where p.id is null',
  },
  {
    name: 'checkpoint_decision_scope_fk',
    table: 'checkpoint_arrival_decisions',
    countSql: 'select count(*)::int as n from checkpoint_arrival_decisions d ' +
      'left join checkpoint_arrival_attempts a on a.id=d.attempt_id ' +
      'and a.order_id=d.order_id where a.id is null',
  },
  {
    name: 'checkpoint_route_consent_scope_fk',
    table: 'performer_route_samples',
    countSql: 'select count(*)::int as n from performer_route_samples s ' +
      'left join checkpoint_gps_consent_events e on e.seq=s.checkpoint_consent_seq ' +
      'and e.plan_id=s.checkpoint_plan_id and e.performer_id=s.performer_id ' +
      'where s.checkpoint_consent=true and s.checkpoint_plan_id is not null ' +
      'and s.checkpoint_consent_seq is not null and e.seq is null',
  },
  {
    name: 'checkpoint_route_consent_order_scope_fk',
    table: 'performer_route_samples',
    countSql: 'select count(*)::int as n from performer_route_samples s ' +
      'left join checkpoint_gps_consent_events e on e.seq=s.checkpoint_consent_seq ' +
      'and e.plan_id=s.checkpoint_plan_id and e.order_id=s.order_id ' +
      'and e.performer_id=s.performer_id ' +
      'where s.checkpoint_consent=true and s.checkpoint_plan_id is not null ' +
      'and s.checkpoint_consent_seq is not null and e.seq is null',
  },
  {
    name: 'checkpoint_consent_requires_scope',
    table: 'performer_route_samples',
    countSql: 'select count(*)::int as n from performer_route_samples s ' +
      'where s.checkpoint_consent=true and ' +
      '(s.checkpoint_plan_id is null or s.checkpoint_consent_seq is null)',
  },
] as const;

export interface CheckpointIntegrityCheck {
  name: string;
  table: string;
  exists: boolean;
  validated: boolean;
  violatingRows: number;
}
export interface CheckpointIntegrityReport {
  checkedAt: string;
  readyToValidate: boolean;
  allValidated: boolean;
  snapshotDigest: string;
  checks: CheckpointIntegrityCheck[];
  startBilling: false;
}

export class CheckpointIntegrityService {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  private requireAdmin(actor: AuthUser) {
    if (!actor?.roles?.includes('admin')) {
      throw forbidden('Аудит целостности КПП доступен только администратору');
    }
  }

  private async read(q: Queryable): Promise<CheckpointIntegrityReport> {
    const rows = await q.query<{ conname: string; convalidated: boolean; table_name: string }>(
      'select conname,convalidated,conrelid::regclass::text as table_name ' +
      'from pg_constraint where conname=any($1::text[]) order by conname',
      [SCOPE_CHECKS.map((c) => c.name)],
    );
    const lookup = new Map(rows.map((r) => [r.conname, r]));
    const checks: CheckpointIntegrityCheck[] = [];
    for (const spec of SCOPE_CHECKS) {
      const schema = lookup.get(spec.name);
      const found = schema != null && schema.table_name === spec.table;
      const count = await q.one<{ n: number }>(spec.countSql);
      checks.push({
        name: spec.name, table: spec.table,
        exists: found, validated: found && !!schema?.convalidated,
        violatingRows: Number(count?.n ?? 0),
      });
    }
    const snapshotDigest = createHash('sha256')
      .update(JSON.stringify(checks.map(({ name, table, exists, validated, violatingRows }) =>
        [name, table, exists, validated, violatingRows])))
      .digest('hex');
    return {
      checkedAt: this.now().toISOString(),
      readyToValidate: checks.every((x) => x.exists && x.violatingRows === 0),
      allValidated: checks.every((x) => x.exists && x.validated),
      snapshotDigest, checks, startBilling: false,
    };
  }

  /** Read-only count-only audit; no affected IDs or GPS leaves the DB. */
  async preview(actor: AuthUser): Promise<CheckpointIntegrityReport> {
    this.requireAdmin(actor);
    return this.db.tx(async (q) => {
      await q.query("select set_config('statement_timeout','15000',true)");
      const report = await this.read(q);
      await q.query(
        'insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [actor.id,'checkpoint.integrity_previewed','checkpoint', {
          digest: report.snapshotDigest, ready: report.readyToValidate,
          violatingConstraints: report.checks.filter((x) => x.violatingRows > 0).length,
        }],
      );
      return report;
    });
  }

  /**
   * Sandbox-only, explicit and race-serialized validation of KNOWN identifiers.
   * Never repairs or deletes preexisting invalid evidence.
   */
  async validate(actor: AuthUser, input: {
    snapshotDigest: string;
    acknowledge: true;
  }): Promise<CheckpointIntegrityReport & { validatedNow: number }> {
    this.requireAdmin(actor);
    if (input?.acknowledge !== true) {
      throw bad('checkpoint_integrity_ack',
        'Нужно явно подтвердить проверку всех ограничений КПП');
    }
    if (!/^[a-f0-9]{64}$/.test(input?.snapshotDigest ?? '')) {
      throw bad('checkpoint_integrity_digest', 'Требуется SHA-256 отчёта предварительного аудита');
    }
    return this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(712024,1)');
      await q.query("select set_config('statement_timeout','30000',true)");
      const before = await this.read(q);
      if (before.snapshotDigest !== input.snapshotDigest) {
        throw conflict('checkpoint_integrity_stale',
          'Данные/ограничения изменились; запустите предварительный аудит заново');
      }
      if (!before.readyToValidate) {
        throw conflict('checkpoint_integrity_dirty',
          'Нарушены исторические связи; нужна ручная сверка перед VALIDATE');
      }
      let validatedNow = 0;
      for (const check of before.checks) {
        if (check.validated) continue;
        const spec = SCOPE_CHECKS.find((x) => x.name === check.name)!;
        // Both identifiers are compile-time constants; no user SQL fragments.
        await q.query('alter table ' + spec.table + ' validate constraint ' + spec.name);
        validatedNow++;
      }
      const after = await this.read(q);
      if (!after.allValidated || !after.readyToValidate) {
        throw conflict('checkpoint_integrity_changed',
          'Не удалось подтвердить целостность исторических данных');
      }
      await q.query(
        'insert into audit_log(actor_id,action,target,data) values($1,$2,$3,$4)',
        [actor.id,'checkpoint.integrity_validated','checkpoint',{
          beforeDigest: input.snapshotDigest, afterDigest: after.snapshotDigest,
          validatedNow, constraints: after.checks.length,
        }],
      );
      return { ...after, validatedNow };
    });
  }
}
