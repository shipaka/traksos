// Durable delivery of a privacy-minimal notice to an operator-configured PRIVATE webhook.
// No phone, name, customer text, email, password, SMS code or other personal
// information is sent to this integration. Developers request sensitive
// diagnostics through an authorized, private support workflow instead.
import type { Db } from '../db/index.ts';
import { config } from '../config.ts';

export type DeveloperReportNotice = {
  event: 'traksos.developer_report.created';
  reportId: string;
  category: string;
  createdAt: string;
  adminUrl: string;
};

export type ReportSender = (notice: DeveloperReportNotice) => Promise<void>;

function configuredSender(): ReportSender | null {
  const url = config.developerReports.webhookUrl.trim();
  const secret = config.developerReports.webhookSecret;
  if (!url && !secret) return null;
  // An HTTPS endpoint and a long server-side secret are both mandatory.
  // The remote server must be under the operator's control; do not configure
  // a public issue tracker here.
  let endpoint: URL;
  try { endpoint = new URL(url); } catch { return null; }
  if (endpoint.protocol !== 'https:' || !endpoint.hostname || endpoint.username ||
      endpoint.password || endpoint.search || endpoint.hash || secret.length < 20) return null;
  return async notice => {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + secret,
        'idempotency-key': notice.reportId,
        'x-traksos-event': notice.event,
      },
      body: JSON.stringify(notice),
    });
    if (!response.ok) throw new Error('delivery_failed');
  };
}

export class DeveloperReportDelivery {
  private readonly sender: ReportSender | null;
  readonly enabled: boolean;
  constructor(private db: Db, sender: ReportSender | null = configuredSender()) {
    this.sender = sender;
    this.enabled = sender !== null;
  }

  async tick(maxReports = 10) {
    if (!this.sender) return 0;
    let processed = 0;
    const count = Math.max(0, Math.min(20, maxReports));
    for (let i = 0; i < count; i++) {
      // Lease the notification inside a transaction; skip rows another worker
      // owns. A crash leaves the row available after the lease expires.
      const leased = await this.db.tx(async q => {
        const row = await q.one<{ id: string; category: string; created_at: Date; delivery_attempts: number }>(
          `select id,category,created_at,delivery_attempts
             from admin_developer_reports
            where status='queued' and delivery_sent_at is null
              and delivery_next_at<=now()
              and (delivery_lease_until is null or delivery_lease_until<now())
            order by delivery_next_at, created_at
            for update skip locked limit 1`);
        if (!row) return null;
        await q.query("update admin_developer_reports set delivery_lease_until=now()+interval '45 seconds' where id=$1", [row.id]);
        return row;
      });
      if (!leased) break;
      const notice: DeveloperReportNotice = {
        event: 'traksos.developer_report.created',
        reportId: leased.id,
        category: leased.category,
        createdAt: new Date(leased.created_at).toISOString(),
        adminUrl: config.publicUrl.replace(/\/$/, '') + '/#/admin/section/access',
      };
      try {
        await this.sender(notice);
        await this.db.query(
          `update admin_developer_reports
              set delivery_sent_at=now(), delivery_lease_until=null,
                  delivery_attempts=delivery_attempts+1, delivery_last_error=null
            where id=$1 and delivery_sent_at is null`, [leased.id]);
      } catch {
        // Never persist the URL, token, HTTP response or exception text.
        // Retry after 1,2,4,... up to 60 minutes. Receiver must deduplicate
        // reportId / idempotency-key if an ACK is lost after acceptance.
        const exponent = Math.min(6, leased.delivery_attempts);
        const minutes = Math.min(60, 2 ** exponent);
        await this.db.query(
          `update admin_developer_reports
              set delivery_attempts=delivery_attempts+1,
                  delivery_lease_until=null,
                  delivery_next_at=now()+($2::int * interval '1 minute'),
                  delivery_last_error='Не доставлено. Автоматический повтор.'
            where id=$1 and delivery_sent_at is null`, [leased.id, minutes]);
      }
      processed++;
    }
    return processed;
  }
}
