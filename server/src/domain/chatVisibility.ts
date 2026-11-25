import type {Queryable} from '../db/index.ts';

// Chat-specific policy. Do not use broad dispatch/order broadcast recipients
// to deliver the private conversation.
export async function currentChatPeople(q:Queryable,orderId:string) {
  return q.query<{id:string;name:string|null;who:string}>(`
    select distinct u.id,u.name,x.who from orders o
    cross join lateral (values (o.client_id,'owner'),
      (case when o.created_by<>o.client_id then o.created_by end,'driver'),
      (o.performer_id,'performer')) x(id,who)
    join users u on u.id=x.id
    where o.id=$1 and u.status='active' and u.deleted_at is null and (
      (x.who='owner' and 'client'=any(u.roles) and u.owner_id is null)
      or (x.who='performer' and u.roles && array['master','tow','service']::text[])
      or (x.who='driver' and 'driver'=any(u.roles) and u.owner_id=o.client_id
        and exists(select 1 from users owner where owner.id=o.client_id
          and owner.status='active' and owner.deleted_at is null
          and 'client'=any(owner.roles) and owner.owner_id is null)
        and exists(select 1 from vehicles v where v.owner_id=o.client_id and v.driver_id=u.id
          and (o.vehicle_id is null or v.id=o.vehicle_id)))
    ) order by x.who,u.id`,[orderId]);
}


// Keep the same customer-financial redaction for historical GET and legacy
// WebSocket consumers. Never change the persisted evidence.
export function redactChatSystemBody(body:string):string{
  if(body.startsWith('Исполнитель закрыл выезд:') || /^Сумма\s+[\d\s,.]+\s*₽/.test(body))
    return 'Клиенту доступен подробный расчёт. Свои удержания и выплаты смотрите в разделе «Финансы».';
  return body;
}
