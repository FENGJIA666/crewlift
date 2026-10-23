import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {AppError} from './constraints.mjs';

const NAME='__Host-crewlift';
export function publicSession({secret,origin}){
  if(typeof secret!=='string'||secret.length<32)throw new Error('CREWLIFT_SESSION_SECRET requires at least 32 random characters.');
  const configured=new URL(origin);
  if(configured.protocol!=='https:'||configured.origin!==origin)throw new Error('CREWLIFT_PUBLIC_ORIGIN must be an exact HTTPS origin without a trailing slash.');
  const sign=id=>createHmac('sha256',secret).update(id).digest('base64url');
  return {
    check(req){
      if(req.headers.host!==configured.host)throw new AppError('HOST_MISMATCH','Open CrewLift at its published demo address.',403);
      if(req.method==='POST'&&req.headers.origin!==origin)throw new AppError('ORIGIN_MISMATCH','Open CrewLift at its published demo address before editing.',403);
    },
    read(req){
      const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${NAME}=`))?.slice(NAME.length+1);
      if(!cookie||!/^([a-f0-9]{48})\.([A-Za-z0-9_-]{43})$/.test(cookie))return null;
      const [id,mac]=cookie.split('.'),expected=sign(id);
      return timingSafeEqual(Buffer.from(mac),Buffer.from(expected))?id:null;
    },
    create(res){const id=randomBytes(24).toString('hex');res.setHeader('Set-Cookie',`${NAME}=${id}.${sign(id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`);return id;},
  };
}
