import {z} from 'zod';
import type {Db} from '../db/index.ts';
import {driverAirSql,requireDriverAir} from './driverAirAccess.ts';
import type {Notifier} from './notify.ts';
import type {Router,AuthUser,AuthedCtx} from '../http/router.ts';
import {parse,bad,forbidden,notFound} from '../http/router.ts';
import {roomLiveRecipients} from './community.ts';

type Channel='dm_invites'|'dm_messages'|'case_replies';
type Preferences={
  dm_invites:boolean;dm_messages:boolean;case_replies:boolean;
  quiet_enabled:boolean;quiet_start_minute:number;quiet_end_minute:number;
  quiet_timezone:string
};
const defaultPreferences:Preferences={
  dm_invites:true,dm_messages:false,case_replies:false,
  quiet_enabled:false,quiet_start_minute:1320,quiet_end_minute:480,
  quiet_timezone:'Europe/Moscow'
};
const preferenceInput=z.object({
  dmInvites:z.boolean(),
  dmMessages:z.boolean(),
  caseReplies:z.boolean(),
  quietEnabled:z.boolean(),
  quietStartMinute:z.number().int().min(0).max(1439),
  quietEndMinute:z.number().int().min(0).max(1439),
  quietTimezone:z.string().trim().min(3).max(80)
});
const uuid=z.string().uuid();
const globalInviteScope='00000000-0000-0000-0000-000000000001';
const channelInfo:Record<Channel,{title:string;body:string;cooldownMinutes:number}>={
  dm_invites:{
    title:'Приглашение в водительский чат',body:'В Эфире есть новый запрос на личную переписку.',
    cooldownMinutes:15
  },
  dm_messages:{
    title:'Новое личное сообщение',body:'В вашем водительском чате появилось сообщение.',
    cooldownMinutes:2
  },
  case_replies:{
    title:'Ответ на технический вопрос',body:'Коллега ответил на ваш вопрос в профессиональном клубе.',
    cooldownMinutes:10
  }
};
function validateZone(zone:string){
  try{
    // No hidden location inference: an IANA timezone explicitly selected by
    // the user is used to calculate the local minute on the server.
    new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit'}).format(new Date());
    return true;
  }catch{return false}
}
export function communityQuietAt(p:Preferences,now:Date){
  if(!p.quiet_enabled)return false;
  if(p.quiet_start_minute===p.quiet_end_minute)return false; // never accidentally block 24h
  const formatter=new Intl.DateTimeFormat('en-GB',{
    timeZone:p.quiet_timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  });
  const parts=formatter.formatToParts(now);
  const hour=Number(parts.find(x=>x.type==='hour')?.value??0);
  const minute=Number(parts.find(x=>x.type==='minute')?.value??0);
  const current=hour*60+minute;
  return p.quiet_start_minute<p.quiet_end_minute
    ?current>=p.quiet_start_minute&&current<p.quiet_end_minute
    :current>=p.quiet_start_minute||current<p.quiet_end_minute;
}
function outward(p:Preferences){
  return {
    dmInvites:p.dm_invites,dmMessages:p.dm_messages,
    caseReplies:p.case_replies,quietEnabled:p.quiet_enabled,
    quietStartMinute:p.quiet_start_minute,quietEndMinute:p.quiet_end_minute,
    quietTimezone:p.quiet_timezone
  };
}
export class CommunityNotifications{
  constructor(private db:Db,private notifier:Notifier,private now:()=>Date){}

  async get(userId:string){
    const saved=await this.db.one<Preferences>(
      'select dm_invites,dm_messages,case_replies,quiet_enabled,quiet_start_minute,'+
      'quiet_end_minute,quiet_timezone from community_notification_preferences where user_id=$1',
      [userId]);
    const [roomMutes,threadMutes]=await Promise.all([
      this.db.query<{id:string}>(
        'select room_id as id from community_notification_room_mutes where user_id=$1 and muted=true',
        [userId]),
      this.db.query<{id:string}>(
        'select thread_id as id from community_notification_thread_mutes where user_id=$1 and muted=true',
        [userId])
    ]);
    return {...outward(saved??defaultPreferences),
      mutedRoomIds:roomMutes.map(x=>x.id),mutedThreadIds:threadMutes.map(x=>x.id),
      appliesOnlyToCommunity:true,
      normalOrderAndSecurityNotificationsUnaffected:true,
      previewNeverContainsMessageText:true
    };
  }

  async deliver(userId:string,event:Record<string,unknown>,
      channel:Channel,scopeId:string,opts?:{roomId?:string;threadId?:string}){
    const sendLive=()=>this.notifier.live([userId],event);
    try{
      const user=await this.db.one<{roles:string[];status:string;driver_access:boolean}>(
        `select u.roles,u.status,${driverAirSql('u')} as driver_access
          from users u where u.id=$1 and u.deleted_at is null`,[userId]);
      if(!user||user.status!=='active'){return}
      if((channel==='dm_messages'||channel==='dm_invites')&&!user.driver_access)return;
      if(channel==='case_replies'&&!user.roles.some(r=>['master','tow','service','admin','moderator'].includes(r)))return;
      const p=await this.db.one<Preferences>(
        'select dm_invites,dm_messages,case_replies,quiet_enabled,quiet_start_minute,'+
        'quiet_end_minute,quiet_timezone from community_notification_preferences where user_id=$1',
        [userId])??defaultPreferences;
      if(!p[channel]||communityQuietAt(p,this.now())){
        sendLive();return;
      }
      if(opts?.roomId){
        const muted=await this.db.one(
          'select 1 from community_notification_room_mutes where user_id=$1 and room_id=$2 and muted=true',
          [userId,opts.roomId]);
        if(muted){sendLive();return}
      }
      if(opts?.threadId){
        const muted=await this.db.one(
          'select 1 from community_notification_thread_mutes where user_id=$1 and thread_id=$2 and muted=true',
          [userId,opts.threadId]);
        if(muted){sendLive();return}
      }
      const item=channelInfo[channel],now=this.now();
      const until=new Date(now.getTime()+item.cooldownMinutes*60_000);
      const available=await this.db.query<{scope_id:string}>(`
        insert into community_notification_cooldowns
          (user_id,channel,scope_id,next_allowed_at)
        values($1,$2,$3,$4)
        on conflict(user_id,channel,scope_id) do update
          set next_allowed_at=excluded.next_allowed_at
          where community_notification_cooldowns.next_allowed_at<=$5
        returning scope_id`,[userId,channel,scopeId,until,now]);
      if(available.length===0){sendLive();return}
      // Minimal remote push: never include nickname, message body, DTC,
      // room title, coordinates, VIN, phone, or links to sensitive content.
      await this.notifier.notify([userId],event,{
        kind:'normal',title:item.title,body:item.body,
        data:{kind:channel}
      });
    }catch{
      // Delivery preferences and external push providers must NEVER turn a
      // successfully stored chat or accepted order into an HTTP failure.
      // Leave a live hint when the alert subsystem itself is unavailable.
      sendLive();
    }
  }
  async dmInvite(userId:string,threadId:string){
    await this.deliver(userId,{type:'community_direct_invite',threadId},
      'dm_invites',globalInviteScope,{threadId});
  }
  async dmMessage(userId:string,threadId:string,messageId:string){
    await this.deliver(userId,{type:'community_direct_message',threadId,id:messageId},
      'dm_messages',threadId,{threadId});
  }
  async caseReply(userId:string,roomId:string,caseId:string){
    await this.deliver(userId,{
      type:'community_technical_case',roomId,caseId,kind:'reply'},
      'case_replies',caseId,{roomId});
  }
}
export function registerCommunityNotificationRoutes(r:Router,db:Db,notifications:CommunityNotifications){
  r.get('/api/community/notification-preferences',true,async(c:AuthedCtx)=>
    notifications.get(c.user.id));
  r.put('/api/community/notification-preferences',true,async(c:AuthedCtx)=>{
    const b=parse(preferenceInput,c.body);
    if(!validateZone(b.quietTimezone))
      throw bad('timezone_invalid','Выберите существующий часовой пояс IANA');
    if(b.quietEnabled&&b.quietStartMinute===b.quietEndMinute)
      throw bad('quiet_interval_invalid','Начало и конец тихого режима должны различаться');
    await db.query(`
      insert into community_notification_preferences
      (user_id,dm_invites,dm_messages,case_replies,quiet_enabled,
        quiet_start_minute,quiet_end_minute,quiet_timezone)
      values($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict(user_id) do update set
        dm_invites=excluded.dm_invites,dm_messages=excluded.dm_messages,
        case_replies=excluded.case_replies,quiet_enabled=excluded.quiet_enabled,
        quiet_start_minute=excluded.quiet_start_minute,
        quiet_end_minute=excluded.quiet_end_minute,
        quiet_timezone=excluded.quiet_timezone,updated_at=now()`,
      [c.user.id,b.dmInvites,b.dmMessages,b.caseReplies,b.quietEnabled,
        b.quietStartMinute,b.quietEndMinute,b.quietTimezone]);
    return notifications.get(c.user.id);
  });
  r.put('/api/community/notification-preferences/rooms/:id',true,async(c:AuthedCtx)=>{
    const id=parse(uuid,c.params.id);
    const b=parse(z.object({muted:z.boolean()}),c.body);
    const room=await db.one<{id:string;audience:string;specialty:string|null;active:boolean}>(
      'select id,audience,specialty,active from community_rooms where id=$1',[id]);
    if(!room?.active)throw notFound('Комната не найдена');
    const allowed=await roomLiveRecipients(db,room);
    if(!allowed.includes(c.user.id))throw notFound('Комната не найдена');
    await db.query(`insert into community_notification_room_mutes(user_id,room_id,muted)
      values($1,$2,$3) on conflict(user_id,room_id) do update set
      muted=excluded.muted,updated_at=now()`,[c.user.id,id,b.muted]);
    return {roomId:id,muted:b.muted};
  });
  r.put('/api/community/notification-preferences/threads/:id',true,async(c:AuthedCtx)=>{
    await requireDriverAir(db,c.user);
    const id=parse(uuid,c.params.id);
    const b=parse(z.object({muted:z.boolean()}),c.body);
    const thread=await db.one('select id from community_dm_threads where id=$1 and (user_a=$2 or user_b=$2)',
      [id,c.user.id]);
    if(!thread)throw notFound('Диалог не найден');
    await db.query(`insert into community_notification_thread_mutes(user_id,thread_id,muted)
      values($1,$2,$3) on conflict(user_id,thread_id) do update set
      muted=excluded.muted,updated_at=now()`,[c.user.id,id,b.muted]);
    return {threadId:id,muted:b.muted};
  });
}
