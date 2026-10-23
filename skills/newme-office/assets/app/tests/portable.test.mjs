import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {createOffice,validateWebhook} from '../server.mjs';
import {createTaskStore} from '../lib/task-store.mjs';

const temp=()=>mkdtemp(path.join(os.tmpdir(),'newme-office-portable-'));
const headers=base=>({'Content-Type':'application/json',Origin:base,'X-Workroom-Action':'tasks'});
async function withApp(run,options={}){const dataDir=await temp(),app=await createOffice({dataDir,port:0,seed:false,webhookUrl:null,...options});try{await run(app,`http://127.0.0.1:${app.port}`,dataDir);}finally{await app.close();}}
test('portable task file survives restart, rejects invalid input without destroying prior tasks',async()=>{
 const dataDir=await temp(),s=await createTaskStore({dataDir,seed:false});await s.upsert({id:'tool-1',title:'真实工具发布的任务',status:'working',provider:'My tool',roleHint:'design'});
 await writeFile(s.file,'invalid JSON');await s.reload();assert.equal(s.snapshot().health.status,'unavailable');assert.equal(s.snapshot().tasks[0].status,'unknown');await assert.rejects(()=>s.upsert({id:'tool-2',title:'must not overwrite'}));assert.equal(await readFile(s.file,'utf8'),'invalid JSON');
 await writeFile(s.file,JSON.stringify({tasks:[{id:'tool-1',title:'已修复的任务',status:'done',reply:'交付内容'}]}));await s.reload();assert.equal(s.snapshot().tasks[0].status,'done');assert.equal(s.snapshot().tasks[0].reply,undefined);assert.equal(s.get('tool-1').reply,'交付内容');
 const again=await createTaskStore({dataDir,seed:false});assert.equal(again.get('tool-1').status,'done');
});
test('HTTP task updates require explicit same-origin action or local API token and never expose token',async()=>withApp(async(app,base,dataDir)=>{
 assert.equal((await fetch(base+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'x'})})).status,403);
 assert.equal((await fetch(base+'/api/tasks',{method:'POST',headers:{...headers('https://untrusted.invalid')},body:JSON.stringify({title:'x'})})).status,403);
 const r=await fetch(base+'/api/tasks',{method:'POST',headers:headers(base),body:JSON.stringify({id:'external-1',title:'不需要模型账号',status:'working',activeRoles:['engineering','design']})});assert.equal(r.status,200);
 const token=(await readFile(path.join(dataDir,'api-token'),'utf8')).trim();
 assert.equal((await fetch(base+'/api/tasks',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({id:'external-1',status:'done',reply:'完成'})})).status,200);
 const state=await (await fetch(base+'/api/state')).json();assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].source,'external');assert.equal(state.tasks[0].status,'done');assert.ok(!JSON.stringify(state).includes(token));assert.ok(!JSON.stringify(state).includes('"reply"'));
 assert.equal((await fetch(base+'/.newme-office/api-token')).status,404);assert.equal((await fetch(base+'/lib/task-store.mjs')).status,404);
 const reply=await (await fetch(base+`/api/reply?taskId=external-1&turnId=${state.tasks[0].turnId}`)).json();assert.equal(reply.text,'完成');
 assert.equal((await (await fetch(base+'/api/reply?taskId=external-1&turnId=wrong')).json()).status,'unavailable');
}));
test('CLI publishes and changes a task from any local tool without Codex installed',async()=>withApp(async(app,base,dataDir)=>{
 async function cli(args){return await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/tasks.mjs',...args,'--url',base,'--data-dir',dataDir],{cwd:new URL('..',import.meta.url),windowsHide:true});let output='',err='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(output)):reject(Error(err)));});}
 await cli(['upsert','--id','any-ai','--title','本机工具任务','--status','working','--provider','My AI','--role','research']);assert.equal(app.store.get('any-ai').status,'working');
 await cli(['upsert','--id','any-ai','--status','done','--reply','输出的结果']);assert.equal(app.store.get('any-ai').reply,'输出的结果');await cli(['remove','--id','any-ai']);assert.equal(app.store.get('any-ai'),undefined);
}));
test('feedback acceptance never claims execution, deduplicates across restart and leaves task status unchanged',async()=>{
 const dataDir=await temp();let sent=0,received;
 const options={dataDir,port:0,seed:false,webhookUrl:'https://adapter.example/feedback',webhookToken:'test-only-value',fetcher:async(url,opts)=>{sent++;received={headers:opts.headers,body:JSON.parse(opts.body)};return new Response(null,{status:202});}};
 let app=await createOffice(options);await app.store.upsert({id:'my-task',title:'连接适配器的任务',status:'idle'});
 const input={taskId:'my-task',text:'请对照任务修正',requestId:randomUUID()};
 async function send(){const base=`http://127.0.0.1:${app.port}`;return fetch(base+'/api/instructions',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,'X-Workroom-Action':'instruction'},body:JSON.stringify(input)});}
 try{const first=await (await send()).json();assert.equal(first.status,'accepted-by-adapter');assert.equal(first.executed,null);assert.equal(app.store.get('my-task').status,'idle');assert.equal(received.headers.Authorization,'Bearer test-only-value');assert.deepEqual(Object.keys(received.body).sort(),['schemaVersion','id','kind','taskId','provider','message','createdAt'].sort());await send();assert.equal(sent,1);await app.close();app=await createOffice(options);await send();assert.equal(sent,1);}finally{await app.close();}
});
test('ambiguous feedback persists as unknown and is not retried on restart',async()=>{
 const dataDir=await temp();let attempts=0;const options={dataDir,port:0,seed:false,webhookUrl:'https://adapter.example/feedback',fetcher:async()=>{attempts++;throw Error('ambiguous failure');}};
 let app=await createOffice(options);await app.store.upsert({id:'my-task',title:'任务',status:'idle'});const input={taskId:'my-task',text:'请修正',requestId:randomUUID()};
 const send=()=>{const base=`http://127.0.0.1:${app.port}`;return fetch(base+'/api/instructions',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,'X-Workroom-Action':'instruction'},body:JSON.stringify(input)});};
 try{assert.equal((await (await send()).json()).error,'outcome_unknown');await app.close();app=await createOffice(options);assert.equal((await (await send()).json()).error,'outcome_unknown');assert.equal(attempts,1);}finally{await app.close();}
});
test('webhook destinations reject remote HTTP, embedded credentials and non-HTTP URLs',()=>{for(const url of ['http://remote.example','https://user:password@example.com','file:///private','javascript:alert(1)'])assert.throws(()=>validateWebhook(url));assert.equal(validateWebhook('http://127.0.0.1:4321/feedback'),'http://127.0.0.1:4321/feedback');});
