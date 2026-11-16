import type http from 'node:http';
import { WebSocketServer } from 'ws';
import type { Db } from '../db/index.ts';
import type { AuthService } from '../services/auth.ts';
import type { Hub } from './hub.ts';
import { bearer } from '../app.ts';

type RealtimeAuth = Pick<AuthService,'authenticate'|'consumeRealtimeTicket'|'authenticateRealtimeSession'>;
export type RealtimeGatewayDependencies = { auth:RealtimeAuth; hub:Hub };
export type RealtimeGatewayOptions = { reauthEveryMs?:number; pingEveryMs?:number };

/**
 * Real /ws gateway, shared by production and isolated load tests. A connection
 * is not proof of permanent authorization: periodically recheck the session
 * and roles, and close the socket when the account or role is revoked.
 *
 * This is deliberately a metadata-only hint channel. Room/DM content stays
 * in permission-checked HTTP endpoints. Do not send credentials in messages.
 */
export function attachRealtimeGateway(server:http.Server,app:RealtimeGatewayDependencies,
  db:Db,options:RealtimeGatewayOptions={}){
  const wss=new WebSocketServer({noServer:true});
  const pingEveryMs=options.pingEveryMs??25_000;
  const reauthEveryMs=options.reauthEveryMs??30_000;
  server.on('upgrade',(req,socket,head)=>{
    void (async()=>{
      const url=new URL(req.url??'/', 'http://x');
      if(url.pathname!=='/ws')return socket.destroy();
      // New clients exchange their bearer for a single-use 30-second ticket.
      // Legacy raw-token clients remain temporarily supported during rollout.
      let access;
      if(url.searchParams.has('ticket')){
        const ticket=url.searchParams.get('ticket')??'';
        const session=await app.auth.consumeRealtimeTicket(ticket);
        if(!session)return socket.destroy();
        access={user:session.user,
          validate:()=>app.auth.authenticateRealtimeSession(session.sessionHash)};
      }else{
        const token=bearer(req);
        if(!token)return socket.destroy();
        const user=await app.auth.authenticate(token);
        if(!user)return socket.destroy();
        access={user,validate:()=>app.auth.authenticate(token)};
      }
      const user=access.user;
      const roles=[...user.roles].sort().join('|');
      const previewUntil=user.roles.includes('admin')
        ? (await db.one<{admin_preview_until:Date|null}>(
            'select admin_preview_until from users where id=$1',[user.id]))?.admin_preview_until??null
        : null;
      wss.handleUpgrade(req,socket,head,ws=>{
        app.hub.add(user.id,ws);
        ws.send(JSON.stringify({type:'hello',userId:user.id}));
        const ping=setInterval(()=>{if(ws.readyState===1)ws.ping()},pingEveryMs);
        const recheck=setInterval(()=>{
          if(ws.readyState!==1)return;
          void access.validate().then(current=>{
            if(!current||current.id!==user.id||[...current.roles].sort().join('|')!==roles)
              ws.close(1008,'Access changed');
          }).catch(()=>ws.close(1008,'Authentication unavailable'));
        },reauthEveryMs);
        // Administrator sandbox sessions must not survive preview expiry.
        const previewTimer=previewUntil
          ? setTimeout(()=>ws.close(1008,'Preview expired'),
            Math.max(0,new Date(previewUntil).getTime()-Date.now()))
          : null;
        ws.on('close',()=>{
          clearInterval(ping);clearInterval(recheck);
          if(previewTimer)clearTimeout(previewTimer);
          app.hub.remove(user.id,ws);
        });
        ws.on('error',()=>{ /* close handler cleans up */ });
      });
    })().catch(()=>socket.destroy());
  });
  return wss;
}
