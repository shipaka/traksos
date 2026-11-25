// Administration-only read model: real case stages, payments, moderation and audit.
// Never fabricate an invoice or reveal this endpoint to a partner role.
import type { Db } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, notFound } from '../http/router.ts';

export function recordedStageLines(stage: any, events: any[]) {
  const lines: {kind:string;description:string;amount:number;source:string}[]=[];
  const add=(kind:string,description:string,value:any,source:string)=>{
    if(value==null||!Number.isFinite(Number(value))||Number(value)<0)return;
    lines.push({kind,description,amount:Number(value),source});
  };
  add('callout','Выезд исполнителя',stage.call_out_amount,'orders.call_out_amount');
  const proposed=events.filter(e=>e.order_id===stage.id&&e.type==='amount_proposed'&&e.data?.bill);
  const bill=proposed.length?proposed[proposed.length-1].data.bill:null;
  if(bill){
    if(Number(bill.time)>0)add('work','Работа по времени',bill.time,'order_events.amount_proposed');
    if(Number(bill.wait)>0)add('wait','Ожидание',bill.wait,'order_events.amount_proposed');
    for(const extra of Array.isArray(bill.extras)?bill.extras:[])
      add('extra',String(extra.name||'Дополнительная позиция').slice(0,200),extra.amount,'order_events.amount_proposed');
  }else{
    add('work','Работы (без построчной расшифровки)',stage.work_amount,'orders.work_amount');
  }
  const billed=lines.filter(x=>x.kind!=='callout').reduce((n,x)=>n+x.amount,0);
  const workVerified=stage.work_amount!=null && (!bill||Number(stage.work_amount)===billed);
  return {lines,workVerified,quoteOnly:stage.status!=='completed'};
}

// Canonical case association wins. A legacy referral with no explicit root
// belongs to the root of its source order, never to a matching plate/name.
const bookingInCase=(root:'r.id'|'$1')=>
  `(b.case_root_id=${root} or (b.case_root_id is null and exists (
    select 1 from orders linked where linked.id=b.from_order_id
      and (linked.id=${root} or linked.case_root_id=${root}))))`;

export class AdminCaseCenter {
  constructor(private db: Db) {}

  async list(rawSearch = '', rawScope = 'all') {
    return (await this.listPage(rawSearch,rawScope,500,null)).items;
  }

  async listPage(rawSearch='',rawScope='all',limit=100,before:string|null=null) {
    if(!Number.isSafeInteger(limit)||limit<1||limit>500)
      throw bad('bad_limit','Размер страницы от 1 до 500');
    if(before){
      const root=await this.db.one('select id from orders where id=$1 and case_root_id is null',[before]);
      if(!root)throw bad('bad_cursor','Страница устарела. Начните с первых обращений');
    }
    const q = rawSearch.trim().slice(0, 80);
    const scope = ['all','active','closed','moderated'].includes(rawScope) ? rawScope : 'all';
    const multiMatch = /^(?:М|M)-?0*(\d+)$/i.exec(q);
    const multiNumber = multiMatch ? Number(multiMatch[1]) : null;
    const search = multiNumber != null ? '' : q.replace(/[%_\\]/g,'');
    const sql = [
      'with cases as (select r.id,r.number,r.client_id,r.vehicle_id,r.status as first_status,',
      'r.created_at as opened_at,r.completed_at as first_completed_at,cr.multi_number,',
      "coalesce(cl.company_name,cl.name,'Клиент') as client_name,",
      'v.plate as vehicle_plate,coalesce(v.brand,r.brand) as vehicle_brand,v.model as vehicle_model,',
      '(select count(*)::int from orders s where s.id=r.id or s.case_root_id=r.id) as order_count,',
      `(select count(*)::int from service_bookings b where ${bookingInCase('r.id')}) as workshop_count,`,
      '(select count(*)::int from ecu_handoffs h where h.root_order_id=r.id) as ecu_count,',
      '(select max(s.created_at) from orders s where s.id=r.id or s.case_root_id=r.id) as last_opened_at,',
      '(select max(s.completed_at) from orders s where s.id=r.id or s.case_root_id=r.id) as last_completed_at,',
      "(exists(select 1 from orders s where (s.id=r.id or s.case_root_id=r.id) and s.status not in ('completed','cancelled','no_performer'))",
      `or exists(select 1 from service_bookings b where ${bookingInCase('r.id')} and b.status not in ('closed','cancelled','declined'))`+
      " or exists(select 1 from ecu_handoffs h where h.root_order_id=r.id and h.state<>'closed')) as has_active,",
      '(exists (select 1 from mod_cases mc where',
      'mc.order_id in (select s.id from orders s where s.id=r.id or s.case_root_id=r.id)',
      `or mc.booking_id in (select b.id from service_bookings b where ${bookingInCase('r.id')}))`,
      'or exists (select 1 from audit_log al where',
      'al.target in (select s.id::text from orders s where s.id=r.id or s.case_root_id=r.id)',
      "and al.action in ('order.resolve','order.discount'))) as moderated",
      'from orders r',
      'left join users cl on cl.id=r.client_id',
      'left join vehicles v on v.id=r.vehicle_id',
      'left join case_registry cr on cr.root_order_id=r.id',
      'where r.case_root_id is null',
      "and ($1::text='' or r.number::text like '%'||$1||'%'",
      "or exists(select 1 from orders s where s.case_root_id=r.id and s.number::text like '%'||$1||'%')",
      "or exists(select 1 from ecu_handoffs h where h.root_order_id=r.id and h.number::text like '%'||$1||'%')",
      `or exists(select 1 from service_bookings b where ${bookingInCase('r.id')} and b.number::text like '%'||$1||'%')`,
      "or r.vehicle_id in (select id from vehicles where plate ilike '%'||$1||'%'))",
      'and ($2::bigint is null or cr.multi_number=$2)',
      'and ($4::uuid is null or (r.created_at,r.id)<(select c.created_at,c.id from orders c where c.id=$4)))',
      "select * from cases where ($3='all' or ($3='active' and has_active) or ($3='closed' and not has_active) or ($3='moderated' and moderated))",
      'order by opened_at desc,id desc limit $5'
    ].join(' ');
    const rows = await this.db.query<any>(sql,[search,multiNumber,scope,before,limit+1]);
    // The predicate is in SQL BEFORE LIMIT. The defensive filter also
    // preserves the legacy service return contract for existing callers.
    const eligible=rows.filter(x =>
      scope==='all' || (scope==='active'&&x.has_active) ||
      (scope==='closed'&&!x.has_active) || (scope==='moderated'&&x.moderated)
    );
    const items=eligible.slice(0,limit).map(x=>({
      ...x,
      is_multi:Number(x.order_count)+Number(x.workshop_count)+Number(x.ecu_count??0)>1,
      case_number:Number(x.order_count)+Number(x.workshop_count)+Number(x.ecu_count??0)>1&&x.multi_number!=null
        ? 'М-'+String(x.multi_number).padStart(6,'0'):null,
    }));
    return {items,hasMore:eligible.length>limit,nextBefore:eligible.length>limit?items[items.length-1].id:null};
  }

  async detail(admin: AuthUser, anyOrderId: string) {
    const row = await this.db.one<{id:string;case_root_id:string|null}>(
      'select id,case_root_id from orders where id=$1',[anyOrderId]);
    if(!row)throw notFound('Заявка не найдена');
    const rootId=row.case_root_id??row.id;
    const stages=await this.db.query<any>([
      'select o.id,o.number,o.service,o.is_sos,o.status,o.client_id,o.created_by,o.performer_id,',
      'o.vehicle_id,o.brand,o.model,o.year,o.problem,o.description,o.address,',
      'o.created_at,o.accepted_at,o.en_route_at,o.arrived_at,o.work_started_at,o.completed_at,o.cancelled_at,',
      'o.estimate,o.call_out_amount,o.work_amount,o.discount_amount,o.payment_method,',
      'o.result,o.result_note,o.continuation_of,',
      'coalesce(u.company_name,u.name) as performer_name,cl.name as client_name',
      'from orders o left join users u on u.id=o.performer_id',
      'left join users cl on cl.id=o.client_id',
      'where o.id=$1 or o.case_root_id=$1 order by o.created_at,o.number'
    ].join(' '),[rootId]);
    const bookings=await this.db.query<any>([
      'select b.id,b.number,b.need,b.status,b.when_day,b.when_time,b.arrival,b.works,',
      'b.created_at,b.updated_at,b.arrived_at,b.ready_at,b.closed_at,',
      'b.amount,b.discount,b.commission,b.center_id,c.name as center_name',
      'from service_bookings b join service_centers c on c.id=b.center_id',
      `where ${bookingInCase('$1')} order by b.created_at,b.number`
    ].join(' '),[rootId]);
    const ecuReferrals=await this.db.query<any>(
      'select h.id,h.number,h.source_order_id,h.state,h.summary,h.created_at,h.selected_at,'+
      'h.selected_performer_id,u.name as selected_performer_name,'+
      'q.diagnosis_price,q.version as quote_version,q.explanation from ecu_handoffs h'+
      ' left join users u on u.id=h.selected_performer_id'+
      ' left join ecu_quotes q on q.id=h.selected_quote_id'+
      ' where h.root_order_id=$1 order by h.created_at,h.number',[rootId]);
    const vehicleId=stages.find((s:any)=>s.vehicle_id)?.vehicle_id??null;
    const vehicle=vehicleId ? await this.db.one<any>(
      'select id,owner_id,driver_id,brand,model,year,plate,trailer_plate,created_at '+
      'from vehicles where id=$1',[vehicleId]) : null;
    const orderIds=stages.map(s=>s.id),bookingIds=bookings.map(b=>b.id);
    const [eventWindow,payments,payouts,moderation,notes,chatWindow,vehicleHistoryWindow,vehicleHistoryBookingsWindow,registry,ordinals,latestProposals]=await Promise.all([
      this.db.query<any>(
        'select e.order_id,e.actor_id,e.type,e.data,e.created_at from order_events e '+
        'where e.order_id=any($1::uuid[]) order by e.created_at desc,e.id desc limit 601',[orderIds]),
      this.db.query<any>(
        'select p.id,p.order_id,p.kind,p.method,p.amount,p.client_fee,p.total,p.status,'+
        'p.refunded_amount,p.created_at from payments p where p.order_id=any($1::uuid[]) '+
        'order by p.created_at,p.id',[orderIds]),
      this.db.query<any>(
        'select po.id,po.order_id,po.amount,po.commission,po.status,po.created_at,po.paid_at '+
        'from payouts po where po.order_id=any($1::uuid[]) order by po.created_at,po.id',
        [orderIds]),
      this.db.query<any>(
        'select id,number,kind,status,title,decision,decision_note,created_at,decided_at,'+
        'order_id,booking_id from mod_cases where order_id=any($1::uuid[]) '+
        'or booking_id=any($2::uuid[]) order by created_at desc',[orderIds,bookingIds]),
      this.db.query<any>(
        'select al.id,al.actor_id,al.action,al.data,al.created_at,'+
        "coalesce(u.name,'Администратор') as actor_name "+
        'from audit_log al left join users u on u.id=al.actor_id '+
        "where (al.target=$1 or al.target=any($2::text[])) and "+
        "(al.action='admin.case_note' or al.action like 'order.%') "+
        'order by al.created_at,al.id',[rootId,orderIds]),
      this.db.query<any>(
        'select m.id,m.order_id,m.sender_id,m.kind,m.body,m.created_at, '+
        "coalesce(u.name,'Система') as sender_name "+
        'from chat_messages m left join users u on u.id=m.sender_id '+
        'where m.order_id=any($1::uuid[]) order by m.created_at desc,m.id desc limit 501',
        [orderIds]),
      vehicleId ? this.db.query<any>(
        'select o.id,o.number,o.service,o.status,o.problem,o.result_note,o.created_at,o.completed_at '+
        'from orders o where o.vehicle_id=$1 and o.id<>all($2::uuid[]) '+
        'order by o.created_at desc,o.id desc limit 101',
        [vehicleId,orderIds]) : Promise.resolve([]),
      vehicleId ? this.db.query<any>(
        'select b.id,b.number,b.status,b.need,b.works,b.created_at,b.closed_at, '+
        'c.name as center_name from service_bookings b '+
        'join service_centers c on c.id=b.center_id '+
        'where b.vehicle_id=$1 and b.id<>all($2::uuid[]) '+
        'order by b.created_at desc,b.id desc limit 101',
        [vehicleId,bookingIds]) : Promise.resolve([]),
      this.db.one<{multi_number:number}>(
        'select multi_number from case_registry where root_order_id=$1',[rootId]),
      this.db.query<any>(
        'select source_kind,source_id,ordinal from case_stage_index where root_order_id=$1 order by ordinal',
        [rootId]),
      // Itemization must not depend on which timeline page was returned.
      this.db.query<any>(
        'select distinct on (e.order_id) e.order_id,e.type,e.data,e.created_at from order_events e '+
        "where e.order_id=any($1::uuid[]) and e.type='amount_proposed' "+
        'order by e.order_id,e.created_at desc,e.id desc',[orderIds])
    ]);
    const events=eventWindow.slice(0,600).reverse();
    const chat=chatWindow.slice(0,500).reverse();
    const vehicleHistory=vehicleHistoryWindow.slice(0,100);
    const vehicleHistoryBookings=vehicleHistoryBookingsWindow.slice(0,100);
    const history_windows={events:{limit:600,hasOlder:eventWindow.length>600},chat:{limit:500,hasOlder:chatWindow.length>500},vehicle_history:{limit:100,hasOlder:vehicleHistoryWindow.length>100},vehicle_history_bookings:{limit:100,hasOlder:vehicleHistoryBookingsWindow.length>100}};
    const stageNo=new Map<string,number>(ordinals.map((x:any)=>[x.source_kind+':'+x.source_id,Number(x.ordinal)]));
    const multi=stages.length+bookings.length+ecuReferrals.length>1;
    await this.db.query(
      "insert into audit_log(actor_id,action,target,data) values ($1,'admin.case_view',$2,$3)",
      [admin.id,rootId,{number:stages[0]?.number,stageCount:stages.length}]);
    return {
      root_id:rootId,
      case_number:multi&&registry?'М-'+String(registry.multi_number).padStart(6,'0'):null,
      multi,
      stages:stages.map((s,i)=>({...s,stage_no:stageNo.get('order:'+s.id)??i+1,recorded_items:recordedStageLines(s,latestProposals)})),
      bookings:bookings.map(b=>({...b,stage_no:stageNo.get('booking:'+b.id)??null})),
      ecu_referrals:ecuReferrals.map((h:any,i:number)=>({...h,stage_no:stageNo.get('ecu:'+h.id)??stages.length+bookings.length+i+1})),
      vehicle,events,payments,payouts,moderation,notes,chat,vehicle_history:vehicleHistory,vehicle_history_bookings:vehicleHistoryBookings,history_windows,
      document_status:'Итоговый счёт требует подтверждённых построчных позиций и первичных документов'
    };
  }

  async historyPage(admin:AuthUser,anyOrderId:string,kind:'events'|'chat'|'vehicle_orders'|'vehicle_bookings',limit=100,before:string|null=null) {
    if(!['events','chat','vehicle_orders','vehicle_bookings'].includes(kind))throw bad('bad_history','Неизвестный раздел истории');
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw bad('bad_limit','Размер страницы от 1 до 100');
    const row=await this.db.one<{id:string;case_root_id:string|null}>(
      'select id,case_root_id from orders where id=$1',[anyOrderId]);
    if(!row)throw notFound('Заявка не найдена');
    const rootId=row.case_root_id??row.id;
    // Table and columns are selected exclusively from a closed enum.
    const caseOrders='select s.id from orders s where s.id=$1 or s.case_root_id=$1';
    const vehicleScope='h.vehicle_id=(select s.vehicle_id from orders s where (s.id=$1 or s.case_root_id=$1) and s.vehicle_id is not null order by s.created_at,s.number limit 1)';
    const config={
      events:{table:'order_events',select:'h.id::text as id,h.order_id,h.actor_id,h.type,h.data,h.created_at',join:'',scoped:'h.order_id in ('+caseOrders+')'},
      chat:{table:'chat_messages',select:"h.id::text as id,h.order_id,h.sender_id,h.kind,h.body,h.created_at,coalesce(u.name,'Система') as sender_name",join:' left join users u on u.id=h.sender_id',scoped:'h.order_id in ('+caseOrders+')'},
      vehicle_orders:{table:'orders',select:'h.id::text as id,h.number,h.service,h.status,h.problem,h.result_note,h.created_at,h.completed_at',join:'',scoped:vehicleScope+' and h.id not in ('+caseOrders+')'},
      vehicle_bookings:{table:'service_bookings',select:'h.id::text as id,h.number,h.status,h.need,h.works,h.created_at,h.closed_at,c.name as center_name',join:' join service_centers c on c.id=h.center_id',scoped:vehicleScope+' and not exists(select 1 from service_bookings b where b.id=h.id and '+bookingInCase('$1')+')'},
    }[kind];
    const {table,select,join,scoped}=config;
    if(before!==null){
      // Resolve the original DB tuple instead of serializing a timestamp
      // through JavaScript (which would lose microseconds).
      const cursor=await this.db.one(
        'select h.id from '+table+' h where '+scoped+' and h.id::text=$2',[rootId,before]);
      if(!cursor)throw bad('bad_cursor','Курсор не принадлежит этой истории. Начните с последних записей');
    }
    const rows=await this.db.query<any>(
      'select '+select+' from '+table+' h'+join+' where '+scoped+
      ' and ($2::text is null or (h.created_at,h.id)<(select h.created_at,h.id from '+table+
      ' h where '+scoped+' and h.id::text=$2)) order by h.created_at desc,h.id desc limit $3',
      [rootId,before,limit+1]);
    const items=rows.slice(0,limit);
    const hasMore=rows.length>limit;
    await this.db.query(
      "insert into audit_log(actor_id,action,target,data) values ($1,'admin.case_history_view',$2,$3)",
      [admin.id,rootId,{kind,before,count:items.length}]);
    return {rootId,kind,items:items.reverse(),hasMore,nextBefore:hasMore?rows[limit-1].id:null};
  }

  async exportOperationalCsv(admin: AuthUser, anyOrderId: string) {
    const detail=await this.detail(admin,anyOrderId);
    const quote=(v:unknown)=>{
      const value=String(v??'');
      const secured=/^[\s\uFEFF]*[=+@\-\t\r]/u.test(value)?"'"+value:value;
      return '"'+secured.replace(/"/g,'""')+'"';
    };
    const table=[
      ['Тип','Мультизаявка','Порядок этапа','Номер заказа','Статус','Название позиции','Сумма коп.','Источник','Проверка']
    ];
    for(const stage of detail.stages){
      const lines=stage.recorded_items?.lines||[];
      if(!lines.length)table.push(['Сведения',detail.case_number||'',String(stage.stage_no),
        String(stage.number),stage.status,'Построчные позиции не подтверждены','','','Нет данных']);
      for(const line of lines)table.push(['Операционная детализация, не чек',detail.case_number||'',
        String(stage.stage_no),String(stage.number),stage.status,line.description,String(line.amount),
        line.source,stage.recorded_items?.workVerified?'Проверено с суммой работ':'Требует сверки']);
    }
    for(const payout of detail.payouts??[]){
      const stage=detail.stages.find((s:any)=>s.id===payout.order_id);
      if(!stage)continue;
      if(payout.amount!=null)table.push(['Реестр выплат (не клиентский счёт)',detail.case_number||'',
        String(stage.stage_no),String(stage.number),payout.status,
        'Сумма выплаты исполнителю',String(payout.amount),'payouts.amount','Факт выплаты проверять по статусу']);
      if(payout.commission!=null)table.push(['Реестр комиссий (не налоговая база)',detail.case_number||'',
        String(stage.stage_no),String(stage.number),payout.status,
        'Удержанная комиссия',String(payout.commission),'payouts.commission','Требуется бухгалтерская сверка']);
    }
    for(const b of detail.bookings){
      table.push(['СТО (свод, не первичный документ)',detail.case_number||'',b.stage_no==null?'':String(b.stage_no),
        String(b.number),b.status,'Работы СТО без деталей первички',
        b.amount==null?'':String(b.amount),'service_bookings.amount','Требует сверки']);
    }
    await this.db.query(
      "insert into audit_log(actor_id,action,target,data) values ($1,'admin.case_export',$2,$3)",
      [admin.id,detail.root_id,{format:'csv',caseNumber:detail.case_number,stageCount:detail.stages.length}]);
    return {filename:'traksos-case-'+(detail.case_number||detail.stages[0]?.number||'case')+'.csv',
      csv:'\uFEFF'+table.map(row=>row.map(quote).join(';')).join('\r\n'),
      notice:'Операционный реестр. Не является кассовым чеком, счётом-фактурой или отчётом агента.'};
  }

  async note(admin: AuthUser, anyOrderId: string, rawComment: string) {
    const comment=rawComment.trim();
    if(comment.length<5||comment.length>1500)
      throw bad('comment_required','Укажите комментарий от 5 до 1500 символов');
    const row=await this.db.one<{id:string;case_root_id:string|null}>(
      'select id,case_root_id from orders where id=$1',[anyOrderId]);
    if(!row)throw notFound('Заявка не найдена');
    const rootId=row.case_root_id??row.id;
    await this.db.query(
      "insert into audit_log(actor_id,action,target,data) values ($1,'admin.case_note',$2,$3)",
      [admin.id,rootId,{comment,orderId:anyOrderId}]);
    return {ok:true,root_id:rootId};
  }
}
