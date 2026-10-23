import http from 'node:http';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {createTaskStore,sampleTasks} from './lib/task-store.mjs';
import {DEFAULT_ROLES} from './lib/roles.mjs';
import {createSelectionStore} from './lib/selection-store.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.wav':'audio/wav','.txt':'text/plain; charset=utf-8','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.woff2':'font/woff2'};
export function validateWebhook(value){if(!value)return null;const u=new URL(value);if(u.username||u.password||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw Error('Feedback URL must use HTTPS, or localhost HTTP, without credentials or redirects.');return u.href;}
export async function createOffice({port=4319,dataDir=path.resolve('.newme-office'),seed=true,webhookUrl=process.env.NEWME_FEEDBACK_URL,webhookToken=process.env.NEWME_FEEDBACK_TOKEN,fetcher=fetch}={}){
  const webhook=validateWebhook(webhookUrl);await mkdir(dataDir,{recursive:true});
  const store=await createTaskStore({dataDir,seed});const selection=createSelectionStore({dataDir});
  const tokenFile=path.join(dataDir,'api-token');let apiToken;try{apiToken=(await readFile(tokenFile,'utf8')).trim();}catch(e){if(e.code!=='ENOENT')throw e;}
  if(apiToken&&!/^[a-f0-9]{64}$/.test(apiToken))throw Error('Invalid local API token file; it was left unchanged.');
  if(!apiToken){apiToken=randomBytes(32).toString('hex');await writeFile(tokenFile,apiToken,{flag:'wx',mode:0o600});}
  const assets=new Map();async function inventory(folder,prefix=''){for(const e of await readdir(folder,{withFileTypes:true})){const rel=prefix+e.name;if(e.isDirectory())await inventory(path.join(folder,e.name),rel+'/');else if(e.isFile())assets.set('/'+rel,path.join(folder,e.name));}}
  await inventory(path.join(ROOT,'public'));assets.set('/',path.join(ROOT,'public/index.html'));assets.set('/favicon.ico',path.join(ROOT,'public/newme-office.ico'));
  for(const name of ['roles.mjs','selection-model.mjs'])assets.set('/'+name,path.join(ROOT,'lib',name));
  const feedbackFile=path.join(dataDir,'feedback.json');let receipts={};try{receipts=JSON.parse(await readFile(feedbackFile,'utf8'));if(!receipts||Array.isArray(receipts)||typeof receipts!=='object')throw Error('Invalid feedback file');}catch(e){if(e.code!=='ENOENT')throw e;}
  const inFlight=new Map(),clients=new Set();let persistQueue=Promise.resolve(),closed=false;
  const saveReceipts=()=>{const content=JSON.stringify(receipts,null,2);const next=persistQueue.then(()=>writeFile(feedbackFile,content,{mode:0o600}));persistQueue=next.catch(()=>{});return next;};
  const state=()=>({...store.snapshot(),roles:DEFAULT_ROLES,cloud:{status:'not-required',taskCount:0},demo:false,updatedAt:new Date().toISOString(),control:{running:[],handoffs:[]},feedbackMode:webhook?'webhook':'local-only'});
  function broadcast(){const encoded=`data: ${JSON.stringify(state())}\n\n`;for(const c of clients){if(c.writableLength>1024*1024){c.destroy();clients.delete(c);}else c.write(encoded);}}
  const refresh=async()=>{if(closed)return;await store.reload();broadcast();};
  const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
  async function json(req,max=128*1024){if(!String(req.headers['content-type']||'').startsWith('application/json'))throw Object.assign(Error('JSON required'),{status:415});const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;if(bytes>max)throw Object.assign(Error('Body too large'),{status:413});chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('Invalid JSON'),{status:400});}}
  const validToken=req=>{const value=req.headers.authorization||'',expected='Bearer '+apiToken;return Buffer.byteLength(value)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(value),Buffer.from(expected));};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const expected=`127.0.0.1:${server.address().port}`;
    if(![expected,`localhost:${server.address().port}`].includes(req.headers.host))return send(res,403,{error:'invalid_host'});
    const origin=req.headers.origin,own=`http://${req.headers.host}`;
    if((origin&&origin!==own)||req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'same_origin_required'});
    let u;try{u=new URL(req.url,own);}catch{return send(res,400,{error:'invalid_url'});}
    const browserAction=action=>origin===own&&req.headers['x-workroom-action']===action;
    try{
      if(u.pathname==='/api/health')return send(res,200,{name:'newme-office',version:'1.0.0',taskMode:'portable',feedbackMode:webhook?'webhook':'local-only'});
      if(u.pathname==='/api/state'&&req.method==='GET')return send(res,200,state());
      if(u.pathname==='/api/connection'&&req.method==='GET')return send(res,200,{mode:'portable',feedbackMode:webhook?'webhook':'local-only',transports:['manual','JSON-file','CLI','HTTP'],requiresModelAccount:false});
      if(u.pathname==='/api/tasks'){
        if(!validToken(req)&&!browserAction('tasks'))return send(res,403,{error:'task_authorization_required'});
        if(req.method==='GET')return send(res,200,{tasks:store.snapshot().tasks});
        if(!['POST','DELETE','PUT'].includes(req.method))return send(res,405,{error:'method_not_allowed'});
        const input=await json(req);
        if(req.method==='DELETE'){if(typeof input.id!=='string')return send(res,400,{error:'invalid_id'});await store.remove(input.id);broadcast();return send(res,200,{removed:true});}
        if(req.method==='PUT'){if(!Array.isArray(input.tasks))return send(res,400,{error:'tasks_required'});await store.replace(input.tasks.map(t=>({...t,sample:false})));broadcast();return send(res,200,{saved:true});}
        const keys=['id','title','status','project','provider','roleHint','activeRoles','summary','reply','url','turnId'];
        if(!input||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))return send(res,400,{error:'invalid_task'});
        const task=await store.upsert(input);broadcast();return send(res,200,{taskId:task.id,task});
      }
      if(u.pathname==='/api/display-selection'){
        if(req.method==='GET')return send(res,200,await selection.read());
        if(req.method!=='PUT')return send(res,405,{error:'put_required'});
        if(!browserAction('display-selection'))return send(res,403,{error:'explicit_action_required'});
        return send(res,200,await selection.write(await json(req,4*1024*1024)));
      }
      if(u.pathname==='/api/instructions'){
        if(req.method!=='POST')return send(res,405,{error:'post_required'});
        if(!browserAction('instruction'))return send(res,403,{error:'explicit_action_required'});
        const input=await json(req,40*1024);
        if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['taskId','text','requestId'].includes(k))||typeof input.taskId!=='string'||typeof input.text!=='string'||!input.text.trim()||input.text.length>8000||input.text.includes('\0')||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.requestId||''))return send(res,400,{error:'invalid'});
        const fingerprint=createHash('sha256').update(JSON.stringify([input.taskId,input.text])).digest('hex');const previous=receipts[input.requestId];
        if(previous){if(previous.fingerprint!==fingerprint)return send(res,409,{error:'request_mismatch'});if(inFlight.has(input.requestId))await inFlight.get(input.requestId);const r=receipts[input.requestId];return send(res,r.code,r.body);}
        const task=store.get(input.taskId);if(!task||task.sample)return send(res,400,{error:'invalid_task'});
        if(!['done','idle','error'].includes(task.status))return send(res,409,{error:'busy'});
        if(Object.keys(receipts).length>=500)return send(res,429,{error:'session_limit'});
        const pending={fingerprint,code:503,body:{taskId:task.id,status:'unknown',error:'outcome_unknown',executed:null}};
        receipts[input.requestId]=pending;await saveReceipts();
        const job=(async()=>{let result;if(!webhook)result={code:200,body:{taskId:task.id,status:'local-only',executed:false}};else try{
          const response=await fetcher(webhook,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json','Idempotency-Key':input.requestId,...(webhookToken?{Authorization:`Bearer ${webhookToken}`}:{})},body:JSON.stringify({schemaVersion:1,id:input.requestId,kind:'dissatisfied',taskId:task.id,provider:task.provider,message:input.text.trim(),createdAt:new Date().toISOString()})});await response.body?.cancel();
          result=response.ok?{code:200,body:{taskId:task.id,status:'accepted-by-adapter',executed:null}}:{code:502,body:{taskId:task.id,status:'rejected',error:'rejected',executed:false}};
        }catch{result={code:503,body:{taskId:task.id,status:'unknown',error:'outcome_unknown',executed:null}};}
        receipts[input.requestId]={fingerprint,...result};await saveReceipts();})();inFlight.set(input.requestId,job);try{await job;}finally{inFlight.delete(input.requestId);}const r=receipts[input.requestId];return send(res,r.code,r.body);
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'get_required'});
      if(u.pathname==='/api/reply'){const task=store.get(u.searchParams.get('taskId'));const turn=u.searchParams.get('turnId');return send(res,200,task&&task.turnId===turn&&task.reply?{status:'available',taskId:task.id,turnId:turn,text:task.reply,truncated:false}:{status:'unavailable'});}
      if(u.pathname==='/api/demo')return send(res,200,{tasks:sampleTasks(),roles:DEFAULT_ROLES,health:{status:'demo'},cloud:{status:'demo'},demo:true,updatedAt:new Date().toISOString()});
      if(u.pathname==='/api/usage')return send(res,200,{status:'not-required',windows:[]});
      if(u.pathname==='/sound-manifest.json')return send(res,200,{available:[]});
      if(u.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream',Connection:'keep-alive'});res.write(`data: ${JSON.stringify(state())}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;}
      const file=assets.get(u.pathname);if(!file)return send(res,404,{error:'not_found'});const bytes=await readFile(file);res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});return res.end(req.method==='HEAD'?undefined:bytes);
    }catch(e){if(!res.headersSent)send(res,e.status||400,{error:'request_failed',message:e.message});else res.end();}
  });
  server.headersTimeout=10000;server.requestTimeout=15000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const timer=setInterval(()=>void refresh(),2000);timer.unref();
  return {server,store,port:server.address().port,dataDir,tokenFile,refresh,close:async()=>{closed=true;clearInterval(timer);for(const c of clients)c.end();await persistQueue;await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);const value=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
  const port=Number(value('--port',process.env.PORT||4319));if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
  const app=await createOffice({port,dataDir:path.resolve(value('--data-dir','.newme-office')),seed:!args.includes('--empty')});
  console.log(`newme office: http://127.0.0.1:${app.port}/\nFull modern/pixel office. No model account required.\nTask file: ${path.join(app.dataDir,'tasks.json')}\nCtrl+C stops this service.`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close().then(()=>process.exit(0)));
}
