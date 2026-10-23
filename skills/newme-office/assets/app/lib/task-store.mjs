import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

export const STATUSES=['working','waiting','done','idle','error','unknown'];
export const ROLE_IDS=['engineering','design','pr','sales','writing','research','planning','operations','other'];
export function sampleTasks(){return ['网站功能开发','品牌视觉设计','市场资料研究','内容撰写'].map((name,i)=>normalizeTask({id:`sample-${i+1}`,title:`示例 · ${name}`,status:i===2?'waiting':'working',project:'示例项目',provider:'示例',sample:true,roleHint:['engineering','design','research','writing'][i]}));}
export function normalizeTask(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Task must be an object');
  const str=(key,max,fallback='')=>{const v=value[key]??fallback;if(typeof v!=='string'||v.length>max||v.includes('\0'))throw Error('Invalid '+key);return v;};
  const id=str('id',200),title=str('title',300).trim(),status=str('status',20,'idle');
  if(!/^[A-Za-z0-9_-]{1,200}$/.test(id)||!title||!STATUSES.includes(status))throw Error('Invalid task identity/title/status');
  const roleHint=str('roleHint',60,'engineering');if(!ROLE_IDS.includes(roleHint))throw Error('Invalid roleHint');
  const project=str('project',200,'我的项目'),provider=str('provider',80,'手动'),reply=str('reply',65536),summary=str('summary',2000);
  const now=new Date().toISOString();
  const updatedAt=str('updatedAt',40,now);if(!Number.isFinite(Date.parse(updatedAt)))throw Error('Invalid updatedAt');
  const turnId=str('turnId',200,randomUUID());if(!/^[A-Za-z0-9_-]{1,200}$/.test(turnId))throw Error('Invalid turnId');
  let url=str('url',2048);if(url){const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error('Invalid task URL');url=parsed.href;}
  const roles=value.activeRoles??[];if(!Array.isArray(roles)||roles.length>9)throw Error('Invalid activeRoles');
  const activeRoles=roles.map(r=>typeof r==='string'?r:r?.roleId).map(roleId=>{if(!ROLE_IDS.includes(roleId))throw Error('Invalid role');return {roleId,evidence:'Provided by task publisher'};});
  return {id,title,status,project,projectName:project,projectKey:`external:${project}`,source:value.sample===true?'sample':'external',provider,roleHint,activeRoles,summary,reply,url,turnId,updatedAt,observedAt:now,sample:value.sample===true};
}
export async function createTaskStore({dataDir,seed=true}){
  await mkdir(dataDir,{recursive:true});const file=path.join(dataDir,'tasks.json');let tasks=[],health={status:'connected'},chain=Promise.resolve(),lastContent='';
  async function write(list){const value=JSON.stringify({schemaVersion:1,tasks:list},null,2);const temp=path.join(dataDir,`.tasks-${randomUUID()}.tmp`);await writeFile(temp,value,{mode:0o600,flag:'wx'});await rename(temp,file);lastContent=value;tasks=list;health={status:'connected',message:'通用任务源 · '+tasks.length+' 个任务'};}
  async function reload(){try{const content=await readFile(file,'utf8');if(Buffer.byteLength(content)>4*1024*1024)throw Error('Task file too large');if(content===lastContent)return;const input=JSON.parse(content),list=Array.isArray(input)?input:input.tasks;if(!Array.isArray(list)||list.length>500)throw Error('Expected up to 500 tasks');const next=list.map(normalizeTask);if(new Set(next.map(t=>t.id)).size!==next.length)throw Error('Duplicate task id');tasks=next;lastContent=content;health={status:'connected',message:'通用任务源 · '+tasks.length+' 个任务'};}catch(e){if(e.code==='ENOENT'&&!lastContent){await write(seed?sampleTasks():[]);return;}health={status:'unavailable',message:'tasks.json 无法读取或格式不正确；已保留上一份任务，不会覆盖文件。'};}}
  await reload();
  const mutate=fn=>{const action=chain.then(async()=>{await reload();if(health.status!=='connected')throw Object.assign(Error('Fix tasks.json before updating'),{status:409});const next=await fn([...tasks]);if(next.length>500)throw Object.assign(Error('Task limit reached'),{status:413});await write(next);return tasks;});chain=action.catch(()=>{});return action;};
  return {file,reload,snapshot:()=>({tasks:tasks.map(({reply,...t})=>({...t,status:health.status==='connected'?t.status:'unknown'})),health}),get:id=>tasks.find(t=>t.id===id),
    upsert:async input=>{const id=input.id||randomUUID();await mutate(list=>{const existing=list.find(t=>t.id===id);const next=normalizeTask({...existing,...input,id,sample:false,updatedAt:new Date().toISOString()});return [...list.filter(t=>t.id!==id),next];});return tasks.find(t=>t.id===id);},
    remove:async id=>{await mutate(list=>list.filter(t=>t.id!==id));},replace:async list=>{if(!Array.isArray(list))throw Error('Expected tasks array');await mutate(()=>list.map(normalizeTask));}};
}
