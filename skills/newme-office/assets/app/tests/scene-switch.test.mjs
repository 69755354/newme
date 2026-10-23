import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {bossPose} from '../public/boss.js';
import {oneWorkerPerTask} from '../public/worker-seats.js';
import {createOffice} from '../server.mjs';

test('switching scenes disposes old renderers and retains live selection, motion and settings',async()=>{
  const instances=[];
  class Renderer {
    constructor(options){Object.assign(this,options);this.ctx={};this.width=900;this.height=700;this.seats=[];instances.push(this);}
    draw(){this.drawn=(this.drawn||0)+1;}
    destroy(){assert.equal(this.destroyed,undefined);this.destroyed=true;}
    setData(tasks,roles,selected){this.tasks=tasks;this.roles=roles;this.selected=selected;this.seats=tasks.map(task=>({task}));this.draw();}
    setMotion(value){this.motion=value;}setTheme(value){this.theme=value;}
    setWandering(value){this.wandering=value;}setBadges(value){this.badges=value;}
  }
  class BossStub{draw(){}destroy(){}act(){}}
  const scope={ModernOffice:Renderer,PixelOffice:Renderer,Boss:BossStub,oneWorkerPerTask,document:{documentElement:{dataset:{}}}};
  const source=(await readFile(new URL('../public/office.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export class Office','class Office');
  vm.runInNewContext(source+'\nthis.Office=Office;',scope);
  const canvas={dataset:{},removeAttribute(){}};
  const office=new scope.Office({canvas,overlay:{replaceChildren(){}},world:{},viewport:{}});
  const tasks=[{taskId:'real-id',roleId:'engineering'}],roles=[{id:'engineering'}];
  office.setData(tasks,roles,'real-id');office.setMotion(false);office.setTheme('dark');office.setWandering(false);
  for(let i=0;i<24;i++)office.setStyle(i%2?'modern':'pixel');
  assert.equal(instances.filter(i=>!i.destroyed).length,1);
  assert.equal(office.renderer.tasks,tasks);assert.equal(office.renderer.roles,roles);
  assert.equal(office.renderer.selected,'real-id');assert.equal(office.renderer.motion,false);
  assert.equal(office.renderer.theme,'dark');assert.equal(office.renderer.wandering,false);
  const old=instances[0],count=old.drawn;old.draw();assert.equal(old.drawn,count,'stale asset callbacks must not paint over new scenes');
  office.destroy();assert.equal(instances.filter(i=>!i.destroyed).length,0);
});

test('two tasks with several role assignments keep exactly two workers through scene switches',async()=>{
  class Renderer{constructor(options){Object.assign(this,options);this.seats=[];}draw(){}destroy(){}setMotion(){}setTheme(){}setData(tasks,roles,selected){this.tasks=tasks;this.roles=roles;this.selected=selected;this.seats=tasks.map(task=>({task}));}}
  const scope={ModernOffice:Renderer,PixelOffice:Renderer,Boss:class{draw(){}destroy(){}},oneWorkerPerTask,document:{documentElement:{dataset:{}}}};
  const source=(await readFile(new URL('../public/office.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export class Office','class Office');
  vm.runInNewContext(source+'\nthis.Office=Office;',scope);
  const canvas={dataset:{},removeAttribute(){}};
  const office=new scope.Office({canvas,overlay:{replaceChildren(){}}});
  const assignments=[{id:'a:engineering',taskId:'a',roleId:'engineering'},{id:'a:research',taskId:'a',roleId:'research'},{id:'b:engineering',taskId:'b',roleId:'engineering'}];
  office.setData(assignments,[{id:'engineering'},{id:'research'}],'a');
  for(const style of ['pixel','modern','pixel','modern']){office.setStyle(style);assert.equal(office.seats?.length||office.renderer.seats.length,2);assert.deepEqual(Array.from(office.renderer.tasks,t=>t.taskId),['a','b']);assert.equal(office.renderer.selected,'a');}
  assert.equal(assignments.length,3,'classification metadata is retained');office.destroy();
});

test('overflow pagination and selected worker use the same page in both scenes',async()=>{
  class Renderer{constructor(options){Object.assign(this,options);this.seats=[];}draw(){}destroy(){}setMotion(){}setTheme(){}setData(tasks,roles,selected){this.tasks=tasks;this.roles=roles;this.selected=selected;this.seats=tasks.map(task=>({task}));}}
  const scope={ModernOffice:Renderer,PixelOffice:Renderer,Boss:class{draw(){}destroy(){}},oneWorkerPerTask,document:{documentElement:{dataset:{}}}};
  const source=(await readFile(new URL('../public/office.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export class Office','class Office');
  vm.runInNewContext(source+'\nthis.Office=Office;',scope);
  const canvas={dataset:{},removeAttribute(){}},overlay={replaceChildren(){}};
  const office=new scope.Office({canvas,overlay});
  const tasks=Array.from({length:7},(_,index)=>({id:`task-${index}:engineering`,taskId:`task-${index}`,roleId:'engineering'}));
  office.setData(tasks,[{id:'engineering'}],'task-5');
  for(const style of ['pixel','modern','pixel']){office.setStyle(style);assert.equal(office.seats.length,3);assert.equal(office.renderer.selected,'task-5');assert.equal(canvas.dataset.workerPage,'2');assert.equal(office.overlay,overlay);}
  office.setPage(0);assert.equal(office.seats.length,4);assert.equal(office.renderer.selected,'task-0');
  office.setStyle('modern');assert.equal(office.seats.length,4);office.select('task-6');assert.equal(office.seats.length,3);assert.equal(office.renderer.selected,'task-6');office.destroy();
});

test('boss sprite states stay within six frames and freeze when animation is off',()=>{
  assert.equal(bossPose('observe',10),0);assert.equal(bossPose('encourage',1),5);
  for(let t=0;t<10;t+=.13){assert.ok([3,4].includes(bossPose('whip',t)));assert.ok([1,2].includes(bossPose('patrol',t)));assert.equal(bossPose('whip',t,false),3);assert.equal(bossPose('patrol',t,false),0);}
});

test('new scenes and artwork are served locally while task files remain private',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'newme-assets-'));
  const app=await createOffice({port:0,dataDir:dir,seed:false});
  try{
    const base=`http://127.0.0.1:${app.port}`;
    for(const file of ['/office.js','/office-modern.js','/office-pixel.js','/boss.js','/newme.css','/assets/tanya-brand-ceo.png','/assets/newme-logo.png','/assets/newme-brand-background.png'])assert.equal((await fetch(base+file)).status,200,file);
    assert.equal((await fetch(base+'/assets/../../config.json')).status,404);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
