import type { Queryable } from '../db/index.ts';
import type { AuthUser } from '../http/router.ts';
import { forbidden } from '../http/router.ts';

// Internal evidence services are not exposed by any HTTP route in this stage.
// Write transactions additionally hold a row lock against concurrent role
// changes. A stale session claim alone never grants financial document access.
export async function requireAgencyAdmin(db:Queryable,actor:AuthUser,lock=false){
  if(!actor?.roles?.includes('admin')||actor.status!=='active')
    throw forbidden('Доступ к агентскому реестру только у действующего администратора');
  const live=await db.one<{id:string}>(
    "select id from users where id=$1 and phone=$2 and status='active' and deleted_at is null and admin_preview_until is null and 'admin'=any(roles)"+(lock?' for share':''),
    [actor.id,actor.phone]);
  if(!live)throw forbidden('Права администратора больше не действуют');
}
