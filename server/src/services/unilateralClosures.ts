import type { Db } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, conflict, forbidden, notFound } from '../http/router.ts';
import type { OrdersService } from './orders.ts';
import type { Notifier } from './notify.ts';
import type { ModerationService } from './moderation.ts';

export type EmergencyReason = 'client_offline'|'client_unreachable'|'client_absent'|'other';
export type EmergencyResponse = { decision:'disagree'; reason:string };
type ClosureRecord = {
  order_id:string;performer_id:string;request_key:string;reason:string;note:string;
  work_amount:number;quote_total:number;quote_at:Date;status:string;
  created_at:Date;answered_at:Date|null;answered_by:string|null;answer_reason:string|null;
};

export class UnilateralClosures {
  constructor(private db:Db, private orders:OrdersService, private notifier:Notifier,
    private moderation:ModerationService, private now:()=>Date=()=>new Date()) {}

  async request(user:AuthUser, orderId:string, p:{
    requestKey:string;reason:EmergencyReason;note:string;workFinished:boolean;
  }) {
    if(!user.roles.some(role=>role==='master'||role==='tow'))
      throw forbidden('Аварийное завершение доступно только назначенному исполнителю');
    const note=p.note.trim();
    if(!p.workFinished||note.length<10||note.length>1500)
      throw bad('emergency_evidence_required','Подтвердите фактическое завершение и опишите причину (10–1500 символов)');
    if(!/^[A-Za-z0-9._:-]{8,100}$/.test(p.requestKey))
      throw bad('emergency_request_key','Нужен уникальный ключ запроса для надёжной повторной отправки');
    const result=await this.db.tx(async q=>{
      const o=await q.one<any>('select * from orders where id=$1 for update',[orderId]);
      if(!o)throw notFound('Заявка не найдена');
      if(o.performer_id!==user.id)throw forbidden('Это не ваша работа');
      const existing=await q.one<ClosureRecord>(
        'select * from order_unilateral_closures where order_id=$1',[orderId]);
      if(existing){
        if(existing.request_key!==p.requestKey||existing.reason!==p.reason||existing.note!==note)
          throw conflict('emergency_already_recorded','По заказу уже оформлено аварийное завершение');
        return {created:false,closure:existing,order:o};
      }
      if(o.status!=='awaiting_confirmation'||o.service==='consult'||
        o.amount_proposed_at==null||o.work_amount==null)
        throw conflict('emergency_not_ready','Сначала завершите выезд и отправьте расчёт клиенту');
      const price=this.orders.money(o);
      const rec=await q.one<ClosureRecord>(
        'insert into order_unilateral_closures(order_id,performer_id,request_key,reason,note,'+
        'work_amount,quote_total,quote_at,created_at) '+
        'values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *',
        [orderId,user.id,p.requestKey,p.reason,note,o.work_amount,price.total,o.amount_proposed_at,this.now()]);
      // The order remains financially unresolved, but no longer occupies the worker.
      // Keep other active jobs and future reservations effective.
      const conflicting=await this.orders.busyWith(q,user.id,orderId);
      if(!conflicting)
        await q.query("update performer_profiles set line_status='online' where user_id=$1 and line_status='on_job'",[user.id]);
      await this.orders.event(q,orderId,user.id,'emergency_work_submitted',{
        reason:p.reason,note,quoteTotal:price.total,quoteAt:o.amount_proposed_at});
      const system=await q.one<any>(
        "insert into chat_messages(order_id,sender_id,kind,body) values($1,null,'system',$2) "+
        'returning id,order_id,sender_id,kind,body,created_at',
        [orderId,'Исполнитель заявил о завершении работы без подтверждения клиента. '+
          'Причина: '+p.reason+'. Расчёт '+(price.total/100).toFixed(2)+
          ' ₽ ожидает ответа заказчика. Деньги не считаются выплаченными.']);
      const customers=[...new Set([o.client_id,o.created_by].filter(Boolean))] as string[];
      for(const customerId of customers)await q.query(
        'insert into notifications(user_id,kind,title,body,data) values($1,$2,$3,$4,$5)',
        [customerId,'unilateral_pending','Подтвердите выполнение заявки №'+o.number,
          'Исполнитель сообщил о завершении. Подтвердите результат и сумму либо укажите причину несогласия.',
          {orderId,unilateral:true}]);
      return {created:true,closure:rec!,order:o,system,customers};
    });
    if(result.created){
      const participants=[...new Set([result.order.client_id,result.order.created_by,user.id].filter(Boolean))] as string[];
      this.notifier.live(participants,{type:'chat',message:result.system});
      this.notifier.live([user.id],{type:'order',orderId,status:'awaiting_confirmation',unilateral:'pending_client'});
      this.notifier.live([user.id],{type:'line_status'});
      await this.notifier.deliverStored(result.customers,{
        type:'order',orderId,status:'awaiting_confirmation',unilateral:true},
        {kind:'normal',title:'Ожидается подтверждение выполнения',
          body:'Заявка №'+result.order.number+': проверьте результат и расчёт',
          data:{orderId}}).catch(e=>console.warn('[unilateral notify]',e));
    }
    return {ok:true,created:result.created,status:result.closure.status,
      operationalStatus:'work_submitted_pending_client',
      quoteTotal:result.closure.quote_total,
      note:'Работа передана на подтверждение. Оплата и окончательное закрытие не подтверждены.'};
  }

  async disagree(user:AuthUser,orderId:string,rawReason:string) {
    const reason=rawReason.trim();
    if(reason.length<10||reason.length>1500)
      throw bad('reason_required','Опишите причину несогласия (10–1500 символов)');
    const result=await this.db.tx(async q=>{
      const o=await q.one<any>('select * from orders where id=$1 for update',[orderId]);
      if(!o)throw notFound('Заявка не найдена');
      if(o.client_id!==user.id&&o.created_by!==user.id)
        throw forbidden('Ответить может только заказчик или его уполномоченный представитель');
      const c=await q.one<ClosureRecord>('select * from order_unilateral_closures where order_id=$1 for update',[orderId]);
      if(!c)throw conflict('no_emergency_closure','Аварийного завершения нет');
      if(c.status==='accepted'||o.status==='completed')
        throw conflict('emergency_already_accepted','Работа уже подтверждена');
      if(c.status==='disputed')return {created:false,order:o,closure:c};
      if(o.status!=='awaiting_confirmation')
        throw conflict('state_changed','Состояние заявки изменилось');
      const row=await q.one<ClosureRecord>(
        "update order_unilateral_closures set status='disputed',answered_by=$2,answered_at=$3,"+
        "answer_reason=$4 where order_id=$1 and status='pending_client' returning *",
        [orderId,user.id,this.now(),reason]);
      if(!row)throw conflict('state_changed','Ответ уже обработан');
      await this.orders.event(q,orderId,user.id,'emergency_disputed',{reason});
      const message=await q.one<any>(
        "insert into chat_messages(order_id,sender_id,kind,body) values($1,null,'system',$2) "+
        'returning id,order_id,sender_id,kind,body,created_at',
        [orderId,'Заказчик не согласен с односторонним завершением: '+reason+
          '. Расчёт остаётся на проверке; подключается модератор.']);
      return {created:true,order:o,closure:row,message};
    });
    // Recover an outstanding moderation case on repeated requests if notification failed.
    const existing=await this.db.one<any>(
      "select id from mod_cases where order_id=$1 and kind='dispute' and status='open' limit 1",[orderId]);
    if(!existing)await this.moderation.open({
      kind:'dispute',openedBy:user.id,orderId,targetId:result.order.performer_id,
      title:'Спор по аварийному завершению заявки №'+result.order.number,
      text:'Клиент оспаривает завершение без связи: '+(result.closure.answer_reason||reason),priority:1});
    if(result.created){
      const parties=[...new Set([result.order.client_id,result.order.created_by,result.order.performer_id].filter(Boolean))] as string[];
      this.notifier.live(parties,{type:'chat',message:result.message});
      await this.notifier.notify([result.order.performer_id],
        {type:'order',orderId,unilateral:'disputed'},
        {kind:'normal',title:'Открыт спор по заявке №'+result.order.number,
          body:'Заказчик оспорил аварийное завершение; ждите модерации',
          data:{orderId}}).catch(e=>console.warn('[unilateral dispute notify]',e));
    }
    return {ok:true,status:'disputed',paymentStatus:'under_review'};
  }
}
