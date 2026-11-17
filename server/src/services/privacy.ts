// Персональные данные: что собираем, выгрузка «всё о себе», запрос на удаление.
// Удаление — через 30 дней: аккаунт обезличивается; заявки и деньги остаются для бухгалтерии, как требует закон.

import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import { conflict, type AuthUser } from '../http/router.ts';

const GRACE_DAYS = 30;

export class PrivacyService {
  constructor(private db: Db, private notifier: Notifier, private now: () => Date) {}

  async status(user: AuthUser) {
    const u = await this.db.one<{ delete_requested_at: Date | null }>('select delete_requested_at from users where id=$1', [user.id]);
    const at = u?.delete_requested_at ?? null;
    return { deleteRequestedAt: at, deleteAt: at ? new Date(new Date(at).getTime() + GRACE_DAYS * 86400_000) : null, graceDays: GRACE_DAYS };
  }

  /** Всё, что TrakSOS хранит о человеке, одним файлом */
  async export(user: AuthUser) {
    const id = user.id;
    const q = (sql: string) => this.db.query(sql, [id]);
    return {
      exportedAt: this.now(),
      account: await this.db.one(`select id, phone, name, roles, status, company_name, company_inn, edo_operator, edo_id, created_at from users where id=$1`, [id]),
      sessions: await q('select created_at, expires_at, device from sessions where user_id=$1 order by created_at desc'),
      consents: await q(`select o.audience, o.version, c.accepted_at from consents c join offers o on o.id=c.offer_id where c.user_id=$1 order by c.accepted_at`),
      vehicles: await q('select brand, model, year, plate, trailer_plate, created_at from vehicles where owner_id=$1 or driver_id=$1'),
      orders: await q(`select number, service, status, description, address, created_at, completed_at, call_out_amount, work_amount
                         from orders where client_id=$1 or created_by=$1 or performer_id=$1 order by created_at`),
      ecuRecommendations: await q(`select r.source_order_id,r.reason,r.status,r.created_at,r.resolved_at,r.linked_order_id
                           from order_ecu_referrals r join orders o on o.id=r.source_order_id
                           where r.suggested_by=$1 or o.client_id=$1 or o.created_by=$1
                           order by r.created_at`),
      messages: await q('select o.number as order_number, m.body, m.created_at from chat_messages m join orders o on o.id=m.order_id where m.sender_id=$1 order by m.created_at'),
      reviewsWritten: await q('select stars, tags, text, created_at from reviews where author_id=$1'),
      reviewsAboutYou: await q('select stars, tags, text, created_at from reviews where target_id=$1'),
      performerProfile: await this.db.one(`select kind, specialties, brands, tax_status, inn, cars, schedule, updated_at from performer_profiles where user_id=$1`, [id]),
      serviceBookings: await q('select number, need, status, when_day, works, amount, created_at from service_bookings where client_id=$1 or created_by=$1'),
      support: await q('select t.number, t.topic, t.status, t.created_at from support_tickets t where t.user_id=$1'),
      shopSelectedRegion: await this.db.one('select city_label,selected_at from shop_customer_regions where user_id=$1',[id]),
      shopPurchases: await q('select number,status,items,goods_total,delivery,delivery_price,total,address,created_at,updated_at from shop_orders where client_id=$1 or created_by=$1'),
      shopDeliveryHistory: await q('select e.shop_order_id,e.status,e.event_time from shop_delivery_events e join shop_orders o on o.id=e.shop_order_id where o.client_id=$1 or o.created_by=$1 order by e.event_time'),
      shopSupplierHistory: await q('select o.number as order_number,e.status,e.event_time,e.cancellation_reason from shop_supplier_order_events e join shop_orders o on o.id=e.shop_order_id where o.client_id=$1 or o.created_by=$1 order by e.event_time'),
      courierProfile: await this.db.one('select display_name,vehicle_label,active,location_consent,created_at from shop_couriers where user_id=$1',[id]),
      courierRuns: await q('select id,status,created_at,accepted_at,departed_at,completed_at from shop_courier_runs where courier_id=$1'),
      courierCurrentLocations: await q('select p.lat,p.lng,p.accuracy_m,p.updated_at from shop_courier_live_positions p join shop_courier_runs r on r.id=p.run_id where r.courier_id=$1'),
      partnerLevels: await q('select level,reason,created_at,review_due_at,current from partner_level_decisions where user_id=$1 order by created_at'),
      partnerLevelAppeals: await q('select message,status,resolution,created_at,resolved_at from partner_level_appeals where user_id=$1 order by created_at'),
      partnerPresenceHistory: await q('select line_status,paused,observed_at from partner_presence_events where user_id=$1 order by observed_at'),
      communityRoadEvents: await q('select room_id,category,locality,description,moderation_state,created_at,expires_at from community_road_events where author_id=$1'),
      communityRoadReports: await q('select event_id,reason,status,created_at from community_road_event_reports where reporter_id=$1'),
      directThreads: await q("select id,status,created_at,updated_at from community_dm_threads where user_a=$1 or user_b=$1"),
      directMessages: await q("select m.thread_id,m.body,m.moderation_state,m.created_at from community_dm_messages m join community_dm_threads t on t.id=m.thread_id where (t.user_a=$1 or t.user_b=$1) and m.sender_id=$1 order by m.created_at"),
      directBlocks: await q('select blocked_id,created_at from community_user_blocks where blocker_id=$1'),
      directMessageReports: await q('select message_id,reason,status,created_at from community_dm_reports where reporter_id=$1'),
      communityProfile: await this.db.one('select nickname,city_label,share_city,created_at from community_profiles where user_id=$1',[id]),
      communityMessages: await q('select room_id,body,moderation_state,created_at from community_messages where sender_id=$1 order by created_at desc'),
      // Visible only in this authenticated export: the public club case never
      // exposes its private source order, even to other verified specialists.
      privateTechnicalCaseOrderLinks: await q('select case_id,order_id,created_at from community_technical_case_order_links where author_id=$1'),
      communityRooms: await q('select room_id,joined_at from community_memberships where user_id=$1'),
      driverAirParticipation: await this.db.one('select enabled,updated_at from community_driver_optins where user_id=$1',[id]),
      communityNotificationPreferences: await this.db.one('select dm_invites,dm_messages,case_replies,quiet_enabled,quiet_start_minute,quiet_end_minute,quiet_timezone,updated_at from community_notification_preferences where user_id=$1',[id]),
      communityRoomMutes: await q('select room_id,muted,updated_at from community_notification_room_mutes where user_id=$1'),
      communityThreadMutes: await q('select thread_id,muted,updated_at from community_notification_thread_mutes where user_id=$1'),
      communityReports: await q('select message_id,reason,status,created_at from community_reports where reporter_id=$1'),
      ownerExperiencePosts: await q('select catalog_category,display_brand,display_model,model_year,topic,title,body,review_state,created_at from vehicle_owner_experiences where author_id=$1 order by created_at'),
      ownerExperienceSaves: await q('select experience_id,created_at from vehicle_owner_experience_saves where user_id=$1'),
      ownerExperienceReports: await q('select experience_id,reason,review_state,created_at from vehicle_owner_experience_reports where reporter_id=$1'),
      knowledgeContributions: await q('select title,make,model,model_year,subsystem,description,source_url,rights_basis,rights_review,technical_review,created_at from community_knowledge where author_id=$1'),
      professionalTechnicalCases: await q('select room_id,make,model,model_year,subsystem,symptoms,dtc_codes,diagnostic_context,status,created_at,resolved_at from community_technical_cases where author_id=$1 order by created_at'),
      professionalTechnicalReplies: await q('select case_id,body,created_at from community_technical_case_replies where author_id=$1 order by created_at'),
      professionalTechnicalReports: await q('select case_id,reply_id,reason,status,decision,review_note,created_at,reviewed_at from community_technical_case_reports where reporter_id=$1 order by created_at'),
      professionalTechnicalAppeals: await q('select report_id,grounds,status,created_at,reviewed_at,review_note from community_technical_case_appeals where appellant_id=$1 order by created_at'),
      professionalEvidenceLinks: await q('select case_id,title,source_url,document_revision,media_kind,rights_note,applicability_note,rights_review,technical_review,status,created_at from community_case_evidence where author_id=$1 order by created_at'),
      warehouseChecksPerformed: await q('select line_index,checked_article,checked_qty,method,manual_reason,checked_at from shop_warehouse_line_checks where checked_by=$1 order by checked_at'),
      notifications: await q('select title, body, created_at from notifications where user_id=$1 order by created_at desc limit 500'),
    };
  }

  async requestDelete(user: AuthUser) {
    const busy = await this.db.one<{ n: number }>(
      `select count(*)::int as n from orders where (client_id=$1 or created_by=$1 or performer_id=$1)
         and status in ('awaiting_owner','searching','accepted','en_route','arrived','working','awaiting_confirmation')`, [user.id]);
    if (busy?.n) throw conflict('active_orders', 'Сначала завершите или отмените открытые заявки');
    const courierBusy=await this.db.one<{n:number}>(
      "select count(*)::int as n from shop_courier_runs where courier_id=$1 "+
      "and status in ('planned','accepted','collecting','delivering','returning')",[user.id]);
    if(courierBusy?.n)throw conflict('active_courier_route','Завершите или передайте курьерский рейс перед удалением аккаунта');
    await this.db.query('update users set delete_requested_at=coalesce(delete_requested_at, $2) where id=$1', [user.id, this.now()]);
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [user.id, 'privacy.delete_requested', user.id, {}]);
    const staff = (await this.db.query<{ id: string }>(`select id from users where roles && '{admin}'::text[]`)).map((r) => r.id);
    await this.notifier.notify(staff, { type: 'privacy' }, { kind: 'normal', title: 'Запрос на удаление данных', body: `Пользователь ${user.phone}: удалим через ${GRACE_DAYS} дней`, data: {} });
    return this.status(user);
  }

  async cancelDelete(user: AuthUser) {
    await this.db.query('update users set delete_requested_at=null where id=$1', [user.id]);
    await this.db.query('insert into audit_log(actor_id, action, target, data) values ($1,$2,$3,$4)', [user.id, 'privacy.delete_cancelled', user.id, {}]);
    return this.status(user);
  }

  /** Раз в тик: срок вышел — обезличиваем. Номер, имя, компания, сессии, токены, машины — убираем. */
  async processDeletions() {
    const due = await this.db.query<{ id: string }>(
      `select id from users where delete_requested_at is not null and deleted_at is null and delete_requested_at < $1::timestamptz - interval '${GRACE_DAYS} days'`, [this.now()]);
    for (const { id } of due) {
      await this.db.tx(async (q) => {
        await q.query(`update users set phone='deleted-' || id, name=null, company_name=null, company_inn=null, edo_operator=null, edo_id=null,
                         status='blocked', deleted_at=$2, owner_id=null where id=$1`, [id, this.now()]);
        // Recommendations are not payment evidence; do not retain their free-form personal data.
        await q.query('delete from order_ecu_referrals where suggested_by=$1 or source_order_id in '+
          '(select id from orders where client_id=$1 or created_by=$1)',[id]);
        await q.query('delete from shop_customer_regions where user_id=$1',[id]);
        await q.query('delete from sessions where user_id=$1', [id]);
        // Courier accounting runs remain for statutory records but the precise
        // live location and personal display name are erased on account deletion.
        await q.query('delete from shop_courier_live_positions where run_id in (select id from shop_courier_runs where courier_id=$1)',[id]);
        await q.query("update shop_couriers set display_name='Обезличенный курьер',vehicle_label=null,active=false,location_consent=false,updated_at=now() where user_id=$1",[id]);
        await q.query('delete from push_tokens where user_id=$1', [id]);
        await q.query('update vehicles set driver_id=null where driver_id=$1', [id]);
        await q.query('delete from notifications where user_id=$1', [id]);
        // Community is not an accounting record: erase pseudonym, city, messages,
        // subscriptions, reports and proposed/licensed-by-user materials on deletion.
        // Review attribution is severed without affecting another author's work.
        // Delete private threads, not just the alias, to avoid retaining DMs after account erasure.
        // This removes the thread for both parties; a retention/legal hold needs a separate process.
        await q.query('delete from community_road_event_reports where reporter_id=$1', [id]);
        await q.query('delete from community_road_events where author_id=$1', [id]);
        await q.query('delete from community_user_blocks where blocker_id=$1 or blocked_id=$1', [id]);
        await q.query('delete from community_dm_reports where reporter_id=$1', [id]);
        await q.query('delete from community_dm_threads where user_a=$1 or user_b=$1', [id]);
        await q.query('delete from community_reports where reporter_id=$1', [id]);
        // Operator notes are community material, never retained as accounting evidence.
        await q.query('delete from vehicle_owner_experience_saves where user_id=$1',[id]);
        await q.query('delete from vehicle_owner_experience_reports where reporter_id=$1',[id]);
        await q.query('delete from vehicle_owner_experiences where author_id=$1',[id]);
        await q.query('update vehicle_owner_experiences set reviewed_by=null where reviewed_by=$1',[id]);
        await q.query('update vehicle_owner_experience_reports set reviewed_by=null where reviewed_by=$1',[id]);
        // Erasing a message also cascades its publication events. Invalidate
        // every affected room's event cursor BEFORE removal, so other drivers
        // cannot keep stale text in their live in-memory chat.
        await q.query(`update community_rooms set event_epoch=event_epoch+1
          where id in (select distinct room_id from community_messages where sender_id=$1)`,[id]);
        await q.query('delete from community_messages where sender_id=$1', [id]);
        await q.query('delete from community_case_evidence where author_id=$1',[id]);
        await q.query('update community_case_evidence set rights_reviewer=null where rights_reviewer=$1',[id]);
        await q.query('update community_case_evidence set technical_reviewer=null where technical_reviewer=$1',[id]);
        await q.query('delete from community_technical_case_reports where reporter_id=$1',[id]);
        await q.query('delete from community_technical_case_appeals where appellant_id=$1',[id]);
        await q.query('update community_technical_case_appeals set reviewed_by=null where reviewed_by=$1',[id]);
        await q.query('update community_technical_case_reports set reviewed_by=null where reviewed_by=$1',[id]);
        // A deleted expert may have an accepted answer on someone else's
        // technical case. Drop that link first to respect the composite FK;
        // then erase their own replies and cases, including copied symptoms.
        await q.query(`update community_technical_cases set accepted_reply_id=null
          where accepted_reply_id in
            (select id from community_technical_case_replies where author_id=$1)`,[id]);
        await q.query('delete from community_technical_case_replies where author_id=$1',[id]);
        await q.query('delete from community_technical_cases where author_id=$1',[id]);
        await q.query('delete from community_notification_preferences where user_id=$1',[id]);
        await q.query('delete from community_notification_room_mutes where user_id=$1',[id]);
        await q.query('delete from community_notification_thread_mutes where user_id=$1',[id]);
        await q.query('delete from community_notification_cooldowns where user_id=$1',[id]);
        await q.query('delete from community_memberships where user_id=$1', [id]);
        await q.query('delete from community_driver_optins where user_id=$1',[id]);
        await q.query('delete from community_knowledge where author_id=$1', [id]);
        await q.query('update community_knowledge set rights_reviewer=null where rights_reviewer=$1', [id]);
        await q.query('update community_knowledge set technical_reviewer=null where technical_reviewer=$1', [id]);
        // The open-source review shelf stores editor attribution only for audit;
        // do not preserve its user reference after scheduled account erasure.
        await q.query('update community_knowledge_sources set technical_reviewer=null where technical_reviewer=$1',[id]);
        // Preserve non-personal warehouse reconciliation, sever the editor's
        // user reference once the deletion grace period ends.
        await q.query('update shop_warehouse_line_checks set checked_by=null where checked_by=$1',[id]);
        await q.query('delete from community_profiles where user_id=$1', [id]);
        await q.query(`update performer_profiles set inn=null, cars='[]', car=null, paused=true where user_id=$1`, [id]);
        // The performer update above creates a final presence trigger event;
        // erase it only AFTER anonymisation to avoid reintroducing location/availability history.
        await q.query('delete from partner_level_appeals where user_id=$1',[id]);
        await q.query('delete from partner_level_decisions where user_id=$1',[id]);
        await q.query('delete from partner_presence_events where user_id=$1',[id]);
        await q.query('insert into audit_log(actor_id, action, target, data) values (null,$1,$2,$3)', ['privacy.deleted', id, {}]);
      });
    }
    return due.length;
  }
}
