import { Office as ModernOffice } from './office-modern.js';
import { Office as PixelOffice } from './office-pixel.js';
import { Boss } from './boss.js';
import { oneWorkerPerTask } from './worker-seats.js';

// One live task model, two disposable renderers. Switching never reconnects or
// copies Codex tasks, and destroys the previous renderer's timers/listeners.
export class Office {
  constructor(options) {
    this.options=options;this.motion=true;this.wandering=true;this.theme='light';
    this.data=[[],[],null];this.badges=[];this.page=0;this.pageSize=4;
    this.boss=new Boss(()=>this.draw());this.boss.visible=options.bossVisible!==false;
    this.setStyle(options.style||'modern');
  }
  get width(){return this.renderer.width;}
  get height(){return this.renderer.height;}
  get scale(){return this.renderer.scale;}
  get seats(){return this.renderer.seats||[];}
  get overlay(){return this.options.overlay;}
  setStyle(value) {
    const style=value==='pixel'?'pixel':'modern';
    if(this.renderer&&this.style===style)return;
    if(this.renderer){
      this.renderer.destroy();this.renderer.pager?.remove();this.renderer.message?.remove();
      this.options.overlay.replaceChildren();
      this.options.canvas.removeAttribute('style');
      for(const key of ['bossMode','bossPose','frame','renderedTasks'])delete this.options.canvas.dataset[key];
    }
    this.boss.action=null;this.style=style;
    document.documentElement.dataset.scene=style;
    this.renderer=new (style==='pixel'?PixelOffice:ModernOffice)(this.options);
    const renderer=this.renderer,draw=renderer.draw.bind(renderer);
    renderer.draw=()=>{if(renderer.destroyed)return;draw();this.boss.draw(renderer,style);renderer.canvas.dataset.renderedTaskIds=JSON.stringify([...new Set((renderer.seats||[]).map(s=>s.task?.taskId||s.task?.id))]);};
    renderer.setMotion(this.motion);renderer.setWandering?.(this.wandering);
    renderer.setTheme(this.theme);renderer.setBadges?.(this.badges);
    this.renderPage();
    renderer.canvas.dataset.sceneStyle=style;
    renderer.canvas.dataset.rendererGeneration=String((this.generation=(this.generation||0)+1));
  }
  setData(tasks,roles,selected){
    this.data=[oneWorkerPerTask(tasks),roles,selected];
    const index=this.data[0].findIndex(task=>(task.taskId||task.id)===selected);
    if(index>=0)this.page=Math.floor(index/this.pageSize);
    this.renderPage();
  }
  renderPage(){
    const [workers,roles,selected]=this.data;
    const pageCount=Math.max(1,Math.ceil(workers.length/this.pageSize));
    this.page=Math.max(0,Math.min(this.page,pageCount-1));
    const visible=workers.length<=this.pageSize?workers:workers.slice(this.page*this.pageSize,(this.page+1)*this.pageSize);
    this.renderer.setData(visible,roles,selected);
    Object.assign(this.options.canvas.dataset,{workerCount:String(workers.length),visibleWorkers:String(visible.length),workerPage:String(this.page+1)});
    if(!document.createElement||!this.options.viewport?.parentElement)return;
    if(!this.sharedPager){this.sharedPager=document.createElement('div');this.sharedPager.className='scene-pager shared-worker-pager';this.options.viewport.parentElement.append(this.sharedPager);}
    this.sharedPager.hidden=pageCount<=1;this.sharedPager.replaceChildren();
    if(this.sharedPager.hidden)return;
    const prev=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');
    prev.type=next.type='button';prev.textContent='上一组';next.textContent='下一组';prev.disabled=this.page===0;next.disabled=this.page===pageCount-1;
    label.textContent=`${this.page*this.pageSize+1}–${Math.min(workers.length,(this.page+1)*this.pageSize)} / ${workers.length}`;
    prev.onclick=()=>this.setPage(this.page-1);next.onclick=()=>this.setPage(this.page+1);this.sharedPager.append(prev,label,next);
  }
  setPage(page){
    const workers=this.data[0];this.page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(workers.length/this.pageSize)-1)));
    const selected=workers[this.page*this.pageSize]?.taskId||workers[this.page*this.pageSize]?.id||null;
    this.data[2]=selected;this.renderPage();if(selected)this.options.onSelect?.(selected);
  }
  select(id){
    const index=this.data[0].findIndex(task=>(task.taskId||task.id)===id),page=index>=0?Math.floor(index/this.pageSize):this.page;
    this.data[2]=id;
    if(page!==this.page){this.page=page;this.renderPage();}
    else if(this.renderer.select)this.renderer.select(id);else this.renderPage();
  }
  setMotion(value){this.motion=Boolean(value);this.renderer.setMotion(this.motion);}
  setWandering(value){this.wandering=Boolean(value);this.renderer.setWandering?.(this.wandering);}
  setTheme(value){this.theme=value;this.renderer.setTheme(value);}
  setBadges(value){this.badges=value;this.renderer.setBadges?.(value);}
  setBossVisible(value){this.boss.visible=Boolean(value);this.options.canvas.dataset.bossVisible=String(this.boss.visible);this.draw();}
  bossAction(action){this.boss.act(action,this.renderer);}
  setScale(value){this.renderer.setScale(value);}
  fit(){this.renderer.fit();}
  draw(){this.renderer?.draw();}
  destroy(){this.renderer.destroy();this.renderer.pager?.remove();this.renderer.message?.remove();this.sharedPager?.remove();this.boss.destroy();}
}
