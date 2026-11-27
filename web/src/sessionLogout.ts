import {API_URL,ApiError,getToken,post,setToken} from './api.ts';
import {native} from './native.ts';

// One explicit logout per session. A different login during the request
// must not be cleared or redirected by the old completion.
let pending:string|null=null;
export async function logoutSession() {
  const token=getToken();
  if(!token||pending===token)return;
  pending=token;
  try{
    try{
      await post('/api/auth/logout');
    }catch(error){
      // The transport already handles a 401 and drops the old identity.
      if(getToken()!==token)return;
      // Preserve server business rules (in particular active_job), and do
      // not treat a forbidden sandbox cross-origin call as a network fault.
      const uncertain=error instanceof ApiError&&(error.status===0||error.status>=500);
      if(!uncertain){
        window.alert(error instanceof Error?error.message:'Не удалось завершить выход');
        return;
      }
      if(!window.confirm('Сервер не подтвердил выход. Выйти только на этом устройстве? Сессия на сервере и статус исполнителя могут оставаться активными. При восстановлении связи проверьте их.'))return;
    }
    if(getToken()!==token)return;
    setToken(null);
    // Notify the already-mounted shell and clear the Android bridge without
    // relying on a full page reload or another successful network request.
    window.dispatchEvent(new Event('traksos-auth-expired'));
    void native.setSession(API_URL||location.origin,null).catch(()=>{});
    location.replace('#/login');
  }finally{
    if(pending===token)pending=null;
  }
}
