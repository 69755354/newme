import {readFile} from 'node:fs/promises';
import path from 'node:path';
const args=process.argv.slice(2),command=args.shift();
const value=(flag,fallback)=>{const i=args.indexOf(flag);return i<0?fallback:args[i+1];};
try{
  const endpoint=new URL(value('--url','http://127.0.0.1:4319/'));
  if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password)throw Error('Use the local office URL.');
  const data=path.resolve(value('--data-dir','.newme-office'));
  const token=(await readFile(path.join(data,'api-token'),'utf8')).trim();
  let method='GET',input;
  if(command==='upsert'){
    method='POST';input={};
    for(const [flag,key] of [['--id','id'],['--title','title'],['--status','status'],['--project','project'],['--provider','provider'],['--role','roleHint'],['--reply','reply'],['--turn','turnId']]){const v=value(flag);if(v!==undefined)input[key]=v;}
    if(value('--file'))input=JSON.parse(await readFile(path.resolve(value('--file')),'utf8'));
  }else if(command==='remove'){method='DELETE';input={id:value('--id')};}
  else if(command!=='list')throw Error('Usage: node scripts/tasks.mjs list|upsert|remove [--id task-id] [--title name] [--status working|waiting|done|idle|error|unknown] [--role engineering] [--file task.json] [--url http://127.0.0.1:4319/] [--data-dir .newme-office]');
  const response=await fetch(new URL('/api/tasks',endpoint),{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
  const result=await response.json();if(!response.ok)throw Error(result.message||result.error);console.log(JSON.stringify(result,null,2));
}catch(e){console.error(e.message);process.exitCode=1;}
