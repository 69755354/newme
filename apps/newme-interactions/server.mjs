import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const ASSETS=new Map([
  ['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/style.css','style.css'],
  ['/interactions.js','interactions.js'],['/slap-detector.js','slap-detector.js'],['/slap-worklet.js','slap-worklet.js'],
  ['/sounds/cartoon-pain-1.wav','sounds/cartoon-pain-1.wav'],['/sounds/cartoon-pain-2.wav','sounds/cartoon-pain-2.wav'],['/sounds/applause.wav','sounds/applause.wav'],
]);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wav':'audio/wav'};
export function validateWebhook(value) {
  if(!value)return null;
  const url=new URL(value);
  const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(url.username||url.password||url.hash||!(url.protocol==='https:'||(local&&url.protocol==='http:')))throw Error('Use an HTTPS webhook, or HTTP on localhost. Put credentials in NEWME_FEEDBACK_TOKEN.');
  return url.href;
}
export async function createInteractionServer({port=4320,webhookUrl=process.env.NEWME_FEEDBACK_URL,token=process.env.NEWME_FEEDBACK_TOKEN,fetcher=fetch}={}) {
  const webhook=validateWebhook(webhookUrl),requests=new Map();
  const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const expected=`127.0.0.1:${server.address().port}`;
    if(![expected,`localhost:${server.address().port}`].includes(req.headers.host))return send(res,403,{error:'invalid_host'});
    let url;try{url=new URL(req.url,`http://${expected}`);}catch{return send(res,400,{error:'invalid_url'});}
    if(url.pathname==='/api/health'&&req.method==='GET')return send(res,200,{name:'newme-interactions',version:'0.1.0',feedbackMode:webhook?'webhook':'local-only'});
    if(url.pathname==='/api/feedback') {
      if(req.method!=='POST')return send(res,405,{error:'post_required'});
      if(req.headers.origin!==`http://${req.headers.host}`||req.headers['x-newme-action']!=='feedback'||req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'explicit_same_origin_action_required'});
      if(!String(req.headers['content-type']||'').startsWith('application/json'))return send(res,415,{error:'json_required'});
      let input;try{const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>8192){send(res,413,{error:'too_large'});req.destroy();return;}chunks.push(chunk);}input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(res,400,{error:'invalid_json'});}
      if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['id','message'].includes(key))||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id||'')||typeof input.message!=='string'||!input.message.trim()||input.message.length>2000||input.message.includes('\0'))return send(res,400,{error:'invalid_feedback'});
      const fingerprint=createHash('sha256').update(input.message).digest('hex'),prior=requests.get(input.id);
      if(prior){if(prior.fingerprint!==fingerprint)return send(res,409,{error:'id_conflict'});const cached=await prior.result;return send(res,cached.code,cached.body);}
      if(requests.size>=500)return send(res,429,{error:'session_limit'});
      const result=(async()=>{
        if(!webhook)return {code:200,body:{status:'local-only',id:input.id,executed:false}};
        try {
          const response=await fetcher(webhook,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json','Idempotency-Key':input.id,...(token?{'Authorization':`Bearer ${token}`}:{})},body:JSON.stringify({schemaVersion:1,id:input.id,kind:'dissatisfied',message:input.message.trim(),createdAt:new Date().toISOString()})});
          await response.body?.cancel();
          return response.ok?{code:200,body:{status:'accepted-by-adapter',id:input.id,executed:null}}:{code:502,body:{status:'rejected',id:input.id,executed:false}};
        }catch{return {code:503,body:{status:'unknown',id:input.id,executed:null}};}
      })();
      requests.set(input.id,{fingerprint,result});const outcome=await result;return send(res,outcome.code,outcome.body);
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'get_required'});
    const asset=ASSETS.get(url.pathname);if(!asset)return send(res,404,{error:'not_found'});
    try{const bytes=await readFile(path.join(ROOT,'public',asset));res.writeHead(200,{'Content-Type':MIME[path.extname(asset)]});res.end(req.method==='HEAD'?undefined:bytes);}catch{return send(res,404,{error:'not_found'});}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,port:server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||4320);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');
  const app=await createInteractionServer({port});
  console.log(`newme interactions: http://127.0.0.1:${app.port}\nOpen this URL in your browser. Ctrl+C stops the local server.`);
}
