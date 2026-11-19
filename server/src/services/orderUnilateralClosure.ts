import type { Db } from '../db/index.ts';
import type { Notifier } from './notify.ts';
import type { OrdersService } from './orders.ts';
import { bad, conflict, forbidden, notFound, type AuthUser } from '../http/router.ts';

/**
 * An operational "I have finished the physical work" declaration.
 * Never confirms money, accepts a bill, captures a bank hold or completes an order.
 * The customer still has to explicitly approve or challenge the frozen bill.
 */
export class OrderUnilateralClosureService {
  constructor(private db: Db, private orders: OrdersService, private notifier: Notifier,
    private now: () => Date) {}

  async submit(user: AuthUser, orderId: string, data: {
    requestKey: string;
    reason: 'no_connection' | 'phone_unavailable' | 'customer_absent' | 'other';
    comment: string;
    physicalWorkConfirmed: boolean;
    evidenceRefs?: string[];
  }) {
    if (!data.physicalWorkConfirmed) throw bad('work_not_confirmed', 'Подтвердите, что работа фактически завершена');
    const comment = data.comment.trim();
    if (comment.length < 10 || comment.length > 1500)
      throw bad('bad_explanation', 'Опишите, что произошло (10–1500 символов)');
    const result = await this.db.tx(async (q) => {
      // The order row is the serialization point for a revised bill / a client decision.
      const o = await q.one<any>('select * from orders where id=$1 for update', [orderId]);
      if (!o) throw notFound('Заявка не найдена');
      if (o.performer_id !== user.id) throw forbidden('Оформить может только назначенный исполнитель');
      if (o.service === 'consult') throw conflict('consult_not_supported', 'Консультация закрывается отдельным сценарием');
      const old = await q.one<any>('select * from order_unilateral_closures where order_id=$1', [orderId]);
      if (old) {
        if (old.performer_id !== user.id || old.request_key !== data.requestKey)
          throw conflict('already_reported', 'По этой заявке уже заявлено аварийное завершение');
        return { o, created: false };
      }
      if (o.status !== 'awaiting_confirmation' || !o.bill?.end || !Number.isInteger(o.work_amount))
        throw conflict('bill_not_frozen', 'Сначала отправьте клиенту окончательный расчёт');
      await q.query(
        `insert into order_unilateral_closures
         (order_id,performer_id,request_key,work_amount,bill_snapshot,reason,comment,evidence_refs,physical_work_confirmed)
         values ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
        [orderId,user.id,data.requestKey,o.work_amount,o.bill,data.reason,comment,data.evidenceRefs ?? []],
      );
      // Free only this physical appointment, and only after DB acknowledgement.
      // Future reservations must be checked by the booking scheduler before allocation.
      await q.query(
        `update performer_profiles set line_status='online'
          where user_id=$1 and line_status='on_job'
            and not exists (
              select 1 from orders x where x.performer_id=$1 and x.id<>$2
                and x.status in ('accepted','en_route','arrived','working','awaiting_confirmation')
                and not (x.service='consult' and x.status='awaiting_confirmation')
                and not (x.status='awaiting_confirmation' and exists (
                  select 1 from order_unilateral_closures u
                    where u.order_id=x.id and u.status in ('pending_client','disputed')))
            )`,
        [user.id,orderId],
      );
      await this.orders.event(q,orderId,user.id,'unilateral_work_reported',{
        reason:data.reason, workAmount:o.work_amount, evidenceCount:(data.evidenceRefs ?? []).length,
      });
      return { o, created: true };
    });
    if (result.created) {
      await this.orders.systemMessage(orderId,
        'Исполнитель заявил о фактическом завершении работ без ответа заказчика. ' +
        'Это не подтверждение суммы и не оплата. Заказчик может согласиться либо оспорить расчёт.');
      await this.notifier.notify([result.o.client_id,result.o.created_by],
        {type:'order',orderId,status:'awaiting_confirmation'},
        {kind:'normal',title:'Работа сдана — нужен ваш ответ',
         body:`Заявка №${result.o.number}: проверьте расчёт, примите его или откройте спор`,
         data:{orderId}});
    }
    return this.orders.view(user,orderId);
  }

  async queue(user: AuthUser) {
    if (!user.roles.some((role) => role === 'admin' || role === 'moderator')) throw forbidden();
    return this.db.query(
      `select u.order_id,u.performer_id,u.reason,u.comment,u.status,u.created_at,
              u.responded_at, o.number,o.service,o.work_amount
         from order_unilateral_closures u join orders o on o.id=u.order_id
        where u.status in ('pending_client','disputed')
        order by case when u.status='disputed' then 0 else 1 end,u.created_at asc limit 100`,
    );
  }
}
