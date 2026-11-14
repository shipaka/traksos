// Read-only external security probes, local CI. All phone numbers are synthetic test fixtures.
const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname))
  throw Error('Staff security tests must only access local CI');
async function request(path, body, token, expected) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...(token ? {authorization: 'Bearer ' + token} : {})},
    body: JSON.stringify(body)
  });
  if (r.status !== expected) throw Error(path + ': HTTP ' + r.status + ' instead of ' + expected);
  return r.json().catch(() => ({}));
}
const adminPhone = '+79990000001';
const moderatorPhone = '+79990000147';
const ordinaryPhone = '+79990000141';
const credentials = {phone: adminPhone, password:'TrakSOS-Test-2026!'};
const owner = await request('/api/auth/login', credentials, null, 200);
if (!owner.user.roles.includes('admin')) throw Error('Admin test fixture absent');
const ordinary = await request('/api/auth/login',
  {phone: ordinaryPhone,password:'Test-Role-Only-2026!'},null,200);
for(const phone of [adminPhone, moderatorPhone]) {
  await request('/api/auth/code',{phone,purpose:'reset'},null,403);
}
for(const roles of [['client','admin'],['client','moderator']]) {
  await request('/api/admin/users/'+ordinary.user.id+'/roles',{roles},owner.token,403);
}
const helper = await request('/api/auth/login',
  {phone: moderatorPhone,password:'Test-Role-Only-2026!'},null,200);
if (!helper.user.roles.includes('master') || !helper.user.roles.includes('moderator'))
  throw Error('Moderator/master fixture absent');
await request('/api/admin/users/'+helper.user.id+'/roles',
  {roles:['master','moderator']},owner.token,200);
const oldSession = await fetch(BASE + '/api/me',{headers:{authorization:'Bearer '+helper.token}});
if (oldSession.status !== 401) throw Error('Role update must revoke prior sessions');
console.log('Staff role allowlists, protected SMS recovery and session revocation: OK');
