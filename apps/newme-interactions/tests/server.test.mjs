import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {createInteractionServer,validateWebhook} from '../server.mjs';

async function withServer(options,run){const app=await createInteractionServer({port:0,webhookUrl:'',token:'',...options});try{await run(`http://127.0.0.1:${app.port}`);}finally{await app.close();}}
const feedback=(base,body,headers={})=>fetch(base+'/api/feedback',{method:'POST',headers:{'Content-Type':'application/json','Origin':base,'X-Newme-Action':'feedback',...headers},body:JSON.stringify(body)});
test('all standalone files load without a model account; private paths and arbitrary files are not served',async()=>withServer({},async base=>{
  assert.equal((await(await fetch(base+'/api/health')).json()).feedbackMode,'local-only');
  for(const name of ['/','/app.js','/interactions.js','/slap-worklet.js','/slap-detector.js','/style.css'])assert.equal((await fetch(base+name)).status,200,name);
  for(const name of ['cartoon-pain-1.wav','cartoon-pain-2.wav','applause.wav']){const r=await fetch(base+'/sounds/'+name);assert.equal(r.headers.get('content-type'),'audio/wav');const data=Buffer.from(await r.arrayBuffer());assert.equal(data.toString('ascii',0,4),'RIFF');assert.ok(data.length>44100);}
  for(const name of ['/.env','/server.mjs','/package.json','/../README.md'])assert.equal((await fetch(base+name)).status,404,name);
  const rejected=await new Promise((resolve,reject)=>{http.get(base+'/api/health',{headers:{Host:'untrusted.example'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);});
  assert.equal(rejected,403);
}));
test('local-only feedback is explicitly unexecuted, rejects bad origin and mismatched idempotency keys',async()=>withServer({},async base=>{
  const input={id:randomUUID(),message:'Please check the missing requirement.'};
  assert.equal((await feedback(base,input,{Origin:'https://other.example'})).status,403);
  assert.equal((await feedback(base,{...input,extra:'audio'})).status,400);
  const accepted=await feedback(base,input);assert.deepEqual(await accepted.json(),{status:'local-only',id:input.id,executed:false});
  assert.equal((await feedback(base,{...input,message:'different'})).status,409);
  assert.equal((await feedback(base,{...input,id:'not-an-id'})).status,400);
}));
test('configured adapter receives only explicit feedback fields, with server-only auth and no automatic retry',async()=>{
  const calls=[];
  await withServer({webhookUrl:'https://adapter.example/feedback',token:'unit-test-placeholder',fetcher:async(url,options)=>{calls.push({url,options});return new Response(null,{status:202});}},async base=>{
    const input={id:randomUUID(),message:'Recheck the result.'};
    for(let i=0;i<2;i++)assert.equal((await(await feedback(base,input)).json()).status,'accepted-by-adapter');
    assert.equal(calls.length,1);assert.equal(calls[0].options.headers.Authorization,'Bearer unit-test-placeholder');assert.equal(calls[0].options.redirect,'error');
    const payload=JSON.parse(calls[0].options.body);assert.deepEqual(Object.keys(payload).sort(),['createdAt','id','kind','message','schemaVersion']);
    assert.equal((await(await fetch(base+'/api/health')).text()).includes('unit-test-placeholder'),false);
  });
});
test('ambiguous network failure stays unknown when same event is submitted again',async()=>{
  let calls=0;await withServer({webhookUrl:'https://adapter.example/feedback',fetcher:async()=>{calls++;throw Error('no response');}},async base=>{
    const input={id:randomUUID(),message:'Recheck.'};for(let i=0;i<2;i++){const r=await feedback(base,input);assert.equal(r.status,503);assert.equal((await r.json()).status,'unknown');}assert.equal(calls,1);
  });
});
test('webhook URL validation rejects credential-bearing URLs, insecure remote hosts and non-HTTP schemes',()=>{
  for(const url of ['http://remote.example/x','https://user:password@example.com','file:///tmp/x','https://example.com/#private'])assert.throws(()=>validateWebhook(url));
  assert.equal(validateWebhook('http://127.0.0.1:4321/feedback'),'http://127.0.0.1:4321/feedback');
});
