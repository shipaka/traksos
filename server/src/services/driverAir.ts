import { createHmac } from 'node:crypto';
import type { Db } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { bad, forbidden, notFound } from '../http/router.ts';
import { maskPhones } from '../util.ts';
import { config } from '../config.ts';
import { suggestTrakBotAirReply } from './trakbotAirPolicy.ts';

type AirRow = { id:string; author_label:string; body:string; origin:string; created_at:Date };
const isStaff = (u:AuthUser) => u.roles.includes('admin') || u.roles.includes('moderator');
const excludedFromChat = new Set(['master','tow','service','insurer','inspection_operator','admin','moderator']);
/** Only ordinary truck owners and fleet drivers can contribute to the community. */
export function canPostInDriverAir(u:Pick<AuthUser,'roles'>):boolean {
  return u.roles.some(r=>r==='client'||r==='driver') &&
    !u.roles.some(r=>excludedFromChat.has(r));
}
export function canReadDriverAir(u:Pick<AuthUser,'roles'>):boolean {
  return canPostInDriverAir(u) || u.roles.includes('admin') || u.roles.includes('moderator');
}
function allowRead(u:AuthUser) {
  if(!canReadDriverAir(u)) throw forbidden('Эфир только для водителей и владельцев автопарков');
}
function allowWrite(u:AuthUser) {
  if(!canPostInDriverAir(u)) throw forbidden('Сообщения в эфир пишут только водители и владельцы автопарков');
}
function recipient(text:string):'admin'|'moderator'|null {
  if(/@(?:admin|админ(?:истратор)?)(?![a-zа-я])|позов.{0,15}админ|вызови.{0,15}админ/i.test(text)) return 'admin';
  if(/@(?:moderator|модератор)(?![a-zа-я])|позов.{0,15}модератор|вызови.{0,15}модератор/i.test(text)) return 'moderator';
  return null;
}
function filterMessage(raw:string):string {
  const text=raw.trim().replace(/\s+/g,' ');
  if(!text || text.length>400) throw bad('air_length','Сообщение должно содержать от 1 до 400 символов');
  if(/https?:\/\/|www\.|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text))
    throw bad('air_links','Ссылки и адреса почты в общем эфире запрещены');
  return maskPhones(text).text.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi,'[VIN скрыт]');
}
function label(user:AuthUser):string {
  const code=createHmac('sha256',config.secret).update(user.id).digest('hex').slice(0,5).toUpperCase();
  return (user.roles.includes('driver') ? 'Водитель ' : 'Владелец ') + code;
}
function expose(rows:AirRow[]) {
  return rows.map(x=>({id:x.id,author:x.author_label,body:x.body,isBot:x.origin==='bot',createdAt:x.created_at}));
}

export class DriverAirService {
  constructor(private db:Db,private now:()=>Date) {}

  async list(user:AuthUser,after=0) {
    allowRead(user);
    const cursor=Number.isSafeInteger(after)&&after>0?after:0;
    const rows=cursor
      ? await this.db.query<AirRow>(
          'select id::text,author_label,body,origin,created_at from driver_air_messages where hidden_at is null and id>$1 order by id asc limit 100',[cursor])
      : (await this.db.query<AirRow>(
          'select id::text,author_label,body,origin,created_at from driver_air_messages where hidden_at is null order by id desc limit 80')).reverse();
    const state=await this.db.one<{bot_enabled:boolean}>('select bot_enabled from driver_air_state where id=true');
    return {messages:expose(rows),botEnabled:!!state?.bot_enabled,canModerate:isStaff(user),
      canConfigure:user.roles.includes('admin'),canPost:canPostInDriverAir(user),publicForDrivers:true};
  }

  async post(user:AuthUser,raw:string) {
    allowWrite(user);
    const text=filterMessage(raw);
    const call=recipient(text);
    const now=this.now();
    return this.db.tx(async q=>{
      // Shared row lock makes bot caps atomic across server instances.
      const state=await q.one<{bot_enabled:boolean;bot_last_at:Date|null;bot_day:string|null;bot_today:number}>(
        "select bot_enabled,bot_last_at,to_char(bot_day,'YYYY-MM-DD') as bot_day,bot_today from driver_air_state where id=true for update");
      if(!state) throw notFound('Эфир не настроен');
      const rate=await q.one<{minute:number;day:number}>(
        "select count(*) filter(where created_at>$2::timestamptz-interval '1 minute')::int as minute, "+
        "count(*) filter(where created_at>$2::timestamptz-interval '1 day')::int as day "+
        "from driver_air_messages where user_id=$1 and origin='human'",[user.id,now]);
      if((rate?.minute??0)>=6||(rate?.day??0)>=80)
        throw bad('air_rate','Слишком много сообщений. Можно написать чуть позже.');
      const body=call
        ? 'Хочу обратиться к '+(call==='admin'?'администратору':'модератору')+' через личную поддержку.'
        : text;
      const human=await q.one<AirRow>(
        "insert into driver_air_messages(user_id,author_label,body,origin,created_at) "+
        "values($1,$2,$3,'human',$4) returning id::text,author_label,body,origin,created_at",
        [user.id,label(user),body,now]);
      if(!human) throw bad('air_write');
      let bot:AirRow|null=null;
      if(call) {
        const note='Уточню: это проблема с заявкой, поведением участника или работой площадки? '+
          'Номер заявки, документы и контакты не публикуй здесь. '+
          'Перейди в «Личное обращение» и опиши детали — их увидят сотрудники. '+
          'Если нужен именно '+(call==='admin'?'администратор':'модератор')+', укажи это в обращении.';
        bot=await q.one<AirRow>(
          "insert into driver_air_messages(user_id,author_label,body,origin,created_at) "+
          "values(null,'TrakBot · бот',$1,'bot',$2) returning id::text,author_label,body,origin,created_at",
          [note,now]);
        // Required safe clarification does not use entertainment quotas.
      } else if(state.bot_enabled) {
        const recent=await q.query<{sender_id:string;body:string;created_at:Date}>(
          "select user_id::text as sender_id,body,created_at from driver_air_messages "+
          "where origin='human' and hidden_at is null and created_at>=$1::timestamptz-interval '1 hour' "+
          "order by id desc limit 80",[now]);
        const day=now.toISOString().slice(0,10);
        const count=state.bot_day===day?state.bot_today:0;
        const suggestion=suggestTrakBotAirReply({
          adminEnabled:true,channelKind:'public-air',nowMs:now.getTime(),
          botMessagesToday:count,lastBotAtMs:state.bot_last_at?.getTime()??null,
          recentHumans:recent.reverse().filter(x=>x.sender_id).map(x=>({
            senderId:x.sender_id,body:x.body,timestampMs:new Date(x.created_at).getTime(),
          })),
        });
        if(suggestion) {
          bot=await q.one<AirRow>(
            "insert into driver_air_messages(user_id,author_label,body,origin,created_at) "+
            "values(null,$1,$2,'bot',$3) returning id::text,author_label,body,origin,created_at",
            [suggestion.displayName,suggestion.body,now]);
          await q.query('update driver_air_state set bot_last_at=$1,bot_day=$2::date,bot_today=$3,updated_at=$1 where id=true',
            [now,day,count+1]);
        }
      }
      return {message:expose([human])[0],botMessage:bot?expose([bot])[0]:null,supportSuggested:!!call};
    });
  }

  async setBot(user:AuthUser,enabled:boolean) {
    if(!user.roles.includes('admin')) throw forbidden('Настройки эфира доступны администратору');
    await this.db.query('update driver_air_state set bot_enabled=$1,updated_at=$2 where id=true',[enabled,this.now()]);
    return {botEnabled:enabled};
  }

  async hide(user:AuthUser,id:string) {
    if(!isStaff(user)) throw forbidden('Доступ только сотрудникам');
    if(!/^[1-9]\d{0,17}$/.test(id)) throw bad('invalid_air_message');
    const row=await this.db.one(
      'update driver_air_messages set hidden_at=$2,hidden_by=$3 where id=$1::bigint and hidden_at is null returning id',
      [id,this.now(),user.id]);
    if(!row) throw notFound('Сообщение не найдено');
    return {hidden:true};
  }
}
