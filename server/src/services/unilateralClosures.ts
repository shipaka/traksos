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


  /**
   * Non-payment SLA: remind once, then open one manual control case.
   * No close, consent, charge, capture, hold extension, or release happens here.
   * Under concurrent app instances, order + closure row locks serialize claims.
   */
  async tickSla(options:{reminderHours?:number; escalationHours?:number}={}) {
    const reminderHours=options.reminderHours??24;
    const escalationHours=options.escalationHours??72;
    if(!Number.isInteger(reminderHours)||reminderHours<1||
       !Number.isInteger(escalationHours)||escalationHours<=reminderHours)
      throw new Error('Invalid unilateral SLA: escalation must follow the reminder');
    const now=this.now();
    const remindBefore=new Date(now.getTime()-reminderHours*3600_000);
    const escalateBefore=new Date(now.getTime()-escalationHours*3600_000);
    let reminded=0,escalated=0;

    const reminders=await this.db.query<{order_id:string}>(
      "select uc.order_id from order_unilateral_closures uc join orders o on o.id=uc.order_id "+
      "where uc.status='pending_client' and o.status='awaiting_confirmation' "+
      "and uc.reminder_sent_at is null and uc.created_at<=$1 "+
      "order by uc.created_at,uc.order_id limit 100",[remindBefore]);
    for(const candidate of reminders){
      const claimed=await this.db.tx(async q=>{
        const order=await q.one<any>(
          'select id,number,status,client_id,created_by from orders where id=$1 for update',
          [candidate.order_id]);
        if(!order||order.status!=='awaiting_confirmation')return null;
        const closure=await q.one<ClosureRecord & {reminder_sent_at:Date|null}>(
          'select * from order_unilateral_closures where order_id=$1 for update',
          [candidate.order_id]);
        if(!closure||closure.status!=='pending_client'||closure.reminder_sent_at||
          new Date(closure.created_at).getTime()>remindBefore.getTime())return null;
        const customers=[...new Set([order.client_id,order.created_by].filter(Boolean))] as string[];
        await q.query('update order_unilateral_closures set reminder_sent_at=$2 where order_id=$1',
          [order.id,now]);
        await this.orders.event(q,order.id,null,'emergency_reminder_sent',
          {reminderHours});
        const message=await q.one<any>(
          "insert into chat_messages(order_id,sender_id,kind,body) values($1,null,'system',$2) "+
          'returning id,order_id,sender_id,kind,body,created_at',
          [order.id,'Напоминание по заявке №'+order.number+
            ': исполнитель сообщил о завершении. Пожалуйста, подтвердите результат или укажите возражение. '+
            'Отсутствие ответа не считается согласием и не приводит к автоматической выплате.']);
        for(const customer of customers)
          await q.query('insert into notifications(user_id,kind,title,body,data) values($1,$2,$3,$4,$5)',
            [customer,'unilateral_reminder','Напоминание по заявке №'+order.number,
              'Проверьте завершённую работу и заявленный расчёт. Согласие не проставляется автоматически.',
              {orderId:order.id,unilateral:true,stage:'reminder'}]);
        return {order,customers,message};
      });
      if(!claimed)continue;
      reminded++;
      this.notifier.live(claimed.customers,{type:'chat',message:claimed.message});
      await this.notifier.deliverStored(claimed.customers,
        {type:'order',orderId:claimed.order.id,unilateral:'reminder'},
        {kind:'normal',title:'Подтвердите заявку №'+claimed.order.number,
          body:'Исполнитель ожидает ответа; согласие или возражение можно оставить в заявке.',
          data:{orderId:claimed.order.id}}).catch(e=>console.warn('[emergency-sla-reminder]',e));
    }

    const overdue=await this.db.query<{order_id:string}>(
      "select uc.order_id from order_unilateral_closures uc join orders o on o.id=uc.order_id "+
      "where uc.status='pending_client' and o.status='awaiting_confirmation' "+
      "and uc.escalated_at is null and uc.created_at<=$1 "+
      "order by uc.created_at,uc.order_id limit 100",[escalateBefore]);
    for(const candidate of overdue){
      const item=await this.db.tx(async q=>{
        const order=await q.one<any>(
          'select id,number,status,client_id,created_by,performer_id from orders where id=$1 for update',
          [candidate.order_id]);
        if(!order||order.status!=='awaiting_confirmation')return null;
        const closure=await q.one<ClosureRecord & {escalated_at:Date|null}>(
          'select * from order_unilateral_closures where order_id=$1 for update',
          [candidate.order_id]);
        if(!closure||closure.status!=='pending_client'||closure.escalated_at||
           new Date(closure.created_at).getTime()>escalateBefore.getTime())return null;
        const oldCase=await q.one<{id:string,number:number}>(
          "select id,number from mod_cases where order_id=$1 and kind='dispute' and status='open' "+
          'order by created_at limit 1',[order.id]);
        const caseRecord=oldCase??await q.one<{id:string,number:number}>(
          "insert into mod_cases(kind,title,text,opened_by,target_id,order_id,priority) "+
          "values('dispute',$1,$2,null,null,$3,2) returning id,number",
          ['Нет ответа клиента по аварийному завершению · заявка №'+order.number,
           'Клиент не ответил после '+escalationHours+
           ' часов. Это НЕ отказ и НЕ согласие. Проверить связь, доказательства и срок платёжной авторизации.',
           order.id]);
        if(!caseRecord)throw new Error('Failed to persist manual escalation');
        await q.query('update order_unilateral_closures set escalated_at=$2,escalation_case_id=$3 where order_id=$1',
          [order.id,now,caseRecord.id]);
        await this.orders.event(q,order.id,null,'emergency_manual_review',
          {caseId:caseRecord.id,escalationHours});
        const system=await q.one<any>(
          "insert into chat_messages(order_id,sender_id,kind,body) values($1,null,'system',$2) "+
          'returning id,order_id,sender_id,kind,body,created_at',
          [order.id,'Ответ клиента по заявке №'+order.number+
           ' не получен. Случай направлен сотрудникам TrakSOS для проверки. '+
           'Расчёт не подтверждён, автоматических списаний или выплат не происходит.']);
        const staff=oldCase?[]:(await q.query<{id:string}>(
          "select id from users where roles && '{admin,moderator}'::text[] and status='active'"))
          .map(x=>x.id);
        for(const staffId of staff)
          await q.query('insert into notifications(user_id,kind,title,body,data) values($1,$2,$3,$4,$5)',
            [staffId,'mod_case','Проверить завершение без ответа клиента · №'+order.number,
              'Просрочено ожидание ответа клиента. Не считать молчание согласием.',
              {caseId:caseRecord.id,orderId:order.id,unilateral:true}]);
        const parties=[...new Set([order.client_id,order.created_by,order.performer_id].filter(Boolean))] as string[];
        return {order,parties,staff,system,caseId:caseRecord.id};
      });
      if(!item)continue;
      escalated++;
      this.notifier.live(item.parties,{type:'chat',message:item.system});
      this.notifier.live(item.staff,{type:'mod_case',caseId:item.caseId});
      await this.notifier.deliverStored(item.staff,{type:'mod_case',caseId:item.caseId},
        {kind:'normal',title:'Проверить аварийное завершение №'+item.order.number,
          body:'Клиент не ответил; требуется ручная проверка без автоматической выплаты.',
          data:{caseId:item.caseId,orderId:item.order.id}})
        .catch(e=>console.warn('[emergency-sla-staff]',e));
    }
    return {reminded,escalated};
  }

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
      await this.notifier.deliverStored(result.customers ?? [],{
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
    else if(result.created){
      // SLA escalation may have opened a monitoring case before the client replied.
      // Upgrade that SAME case to a dispute instead of producing two moderator tickets.
      await this.db.query(
        "update mod_cases set priority=1, text=coalesce(text,'') || E'\\n— ' || $2 "+
        "where id=$1 and status='open'",
        [existing.id,'Клиент оспаривает завершение: '+reason]);
      const staff=(await this.db.query<{id:string}>(
        "select id from users where roles && '{admin,moderator}'::text[] and status='active'"))
        .map(x=>x.id);
      await this.notifier.notify(staff,{type:'mod_case',caseId:existing.id},
        {kind:'normal',title:'Клиент оспорил аварийное завершение №'+result.order.number,
          body:'Новое возражение приложено к уже открытому делу; требуется разбор.',
          data:{caseId:existing.id,orderId}})
        .catch(e=>console.warn('[emergency dispute staff]',e));
    }
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
