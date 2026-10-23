const MODERN_STOPS = [[835,720],[855,545],[810,430],[865,510]];
const ACTION_STOPS = [[700,450],[850,405],[820,755],[875,790]];
export function bossPose(mode, elapsed, motion=true) {
  if(mode==='whip')return 3+(motion&&Math.floor(elapsed*4)%2);
  if(mode==='encourage')return 5;
  if(mode==='patrol'&&motion)return 1+Math.floor(elapsed*5)%2;
  return 0;
}
export class Boss {
  constructor(redraw) {
    this.visible=true;this.action=null;this.lastStatus='';this.redraw=redraw;
    this.image=new Image();this.image.onload=()=>this.redraw();
    this.image.src='./assets/tanya-brand-ceo.png';
  }
  act(action,renderer) {
    this.action={kind:action,started:renderer.time||0,target:renderer.selected};
    this.redraw();
  }
  draw(renderer,style) {
    if(!this.visible)return;
    const ctx=renderer.ctx,time=renderer.time||0,pixel=style==='pixel';
    let action=this.action,elapsed=action?time-action.started:0;
    if(action&&elapsed>8&&action.kind!=='patrol')this.action=action=null;
    const seats=renderer.seats||[];
    const target=seats.find(s=>s.task?.taskId===action?.target||s.task?.id===action?.target||s.key===action?.target)
      ||seats.find(s=>s.task?.taskId===renderer.selected||s.task?.id===renderer.selected||s.key===renderer.selected)||seats[0];
    let mode=action?.kind||(time%24<9?'observe':'patrol');
    if(!target&&['whip','encourage'].includes(mode))mode='observe';
    let x,y,tx,ty;
    if(pixel) {
      x=renderer.width*.74+(mode==='patrol'?Math.sin(time*.36)*Math.min(60,renderer.width*.07):0);y=176;
      if(target){tx=target.x+target.w*.5;ty=target.y+45;}
    } else {
      const progress=mode==='patrol'?(time*.09)%MODERN_STOPS.length:1;
      const a=MODERN_STOPS[Math.floor(progress)],b=MODERN_STOPS[(Math.floor(progress)+1)%MODERN_STOPS.length],f=progress%1;
      x=a[0]+(b[0]-a[0])*f;y=a[1]+(b[1]-a[1])*f;
      if(target){tx=target.x+target.w*.5;ty=target.y+target.h*.68;}
    }
    if(target&&['whip','encourage'].includes(mode)) {
      const position=pixel?[Math.max(65,target.x-20),target.y+100]:ACTION_STOPS[target.slot??0];
      const f=renderer.motion?Math.min(1,elapsed/1.2):1;
      x+=(position[0]-x)*f;y+=(position[1]-y)*f;
    }
    const pose=bossPose(mode,elapsed||time,renderer.motion),size=pixel?82:218;
    ctx.save();
    ctx.imageSmoothingEnabled=!pixel;
    ctx.fillStyle='#1d302b25';ctx.beginPath();ctx.ellipse(x,y-2,size*.17,size*.045,0,0,Math.PI*2);ctx.fill();
    if(pixel)this.drawPixel(ctx,x,y,mode,time,renderer.motion);
    else if(this.image.complete&&this.image.naturalWidth) {
      const cw=this.image.naturalWidth/3,ch=this.image.naturalHeight/2;
      ctx.save();ctx.translate(x,y);
      if(target&&tx<x&&['whip','encourage'].includes(mode))ctx.scale(-1,1);
      const bob=renderer.motion&&mode==='encourage'?Math.sin(time*9)*2:0;
      ctx.drawImage(this.image,pose%3*cw,Math.floor(pose/3)*ch,cw,ch,-size/2,-size*.94+bob,size,size);
      ctx.restore();
    }
    if(target&&mode==='whip'&&elapsed>1.2) {
      const phase=renderer.motion?(elapsed*2.3)%1:.75;
      ctx.strokeStyle=phase>.55?'#c4964b':'#40352b';ctx.lineWidth=pixel?2:3;
      ctx.beginPath();ctx.moveTo(x,y-size*.60);
      ctx.quadraticCurveTo((x+tx)/2,y-size*(.8+Math.sin(phase*Math.PI)*.5),tx,ty);ctx.stroke();
      if(phase>.58){
        ctx.strokeStyle='#e3ba6a';ctx.lineWidth=2;
        for(let i=0;i<5;i++){const a=i*Math.PI*2/5;ctx.beginPath();ctx.moveTo(tx+Math.cos(a)*10,ty+Math.sin(a)*10);ctx.lineTo(tx+Math.cos(a)*22,ty+Math.sin(a)*22);ctx.stroke();}
        this.bubble(ctx,'啪！',tx,ty-36,pixel);
      }
    }
    if(target&&mode==='encourage') {
      ctx.fillStyle='#66a98c';
      for(let i=0;i<4;i++){const phase=(time*.8+i*.25)%1;ctx.globalAlpha=1-phase;ctx.fillRect(tx-30+i*18,ty-20-phase*55,4,7);}
      ctx.globalAlpha=1;this.bubble(ctx,'干得不错！',tx,ty-70,pixel);
    }
    this.bubble(ctx,mode==='whip'?'Tanya · 催工':mode==='encourage'?'Tanya · 鼓励':mode==='patrol'?'Tanya · 巡视':'Tanya · CEO',x,y-size-10,pixel);
    ctx.restore();
    renderer.canvas.dataset.bossMode=mode;renderer.canvas.dataset.bossPose=String(pose);
    const status=mode==='whip'?'挥鞭催工中':mode==='encourage'?'正在鼓励团队':mode==='patrol'?'巡视办公室':'观察团队工作';
    if(status!==this.lastStatus){const node=document.querySelector('#boss-status');if(node)node.textContent=status;for(const button of document.querySelectorAll('#boss-controls button'))button.setAttribute('aria-pressed',String(button.dataset.action===mode));this.lastStatus=status;}
  }
  bubble(ctx,text,x,y,pixel) {
    ctx.save();ctx.font=`600 ${pixel?12:17}px "Segoe UI","Microsoft YaHei UI",sans-serif`;
    const width=ctx.measureText(text).width+22,h=pixel?24:32;
    ctx.fillStyle='#ffffffef';ctx.strokeStyle='#a8bbb3';ctx.lineWidth=1;
    ctx.beginPath();ctx.roundRect(x-width/2,y-h,width,h,pixel?3:7);ctx.fill();ctx.stroke();
    ctx.fillStyle='#29473d';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x,y-h/2);ctx.restore();
  }
  drawPixel(ctx,x,y,mode,time,motion) {
    const rect=(dx,dy,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(Math.round(x+dx),Math.round(y+dy),w,h);};
    const step=mode==='patrol'&&motion?Math.sin(time*9)*5:0;
    rect(-9,-29,7,25+step,'#bc0068');rect(3,-29,7,25-step,'#bc0068');
    rect(-12,-6+step,12,5,'#17262b');rect(3,-6-step,13,5,'#17262b');
    rect(-14,-56,29,30,'#fc008b');rect(-4,-56,9,25,'#edece2');
    rect(-14,-83,28,35,'#48302d');rect(-9,-77,20,20,'#e0b697');rect(-13,-83,26,9,'#48302d');rect(-14,-76,7,28,'#48302d');rect(10,-73,5,25,'#48302d');
    rect(-7,-81,14,5,'#614137');rect(-4,-77,8,4,'#48302d');rect(-16,-67,5,9,'#614137');rect(12,-62,5,12,'#614137');rect(-13,-52,5,5,'#614137');rect(10,-51,5,6,'#614137');rect(2,-61,4,2,'#a94b55');
    const arm=mode==='encourage'&&motion?Math.sin(time*10)*4:0;
    rect(-20,-54+arm,7,23,'#fc008b');rect(14,-54-arm,7,23,'#fc008b');
    rect(-20,-34+arm,7,6,'#d7b18f');rect(14,-34-arm,7,6,'#d7b18f');
    if(mode==='encourage'){ctx.strokeStyle='#fc008b';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(x-16,y-48);ctx.lineTo(x-3-arm/2,y-39);ctx.moveTo(x+17,y-48);ctx.lineTo(x+3+arm/2,y-39);ctx.stroke();rect(-6-arm/2,-42,6,6,'#d7b18f');rect(1+arm/2,-42,6,6,'#d7b18f');}
    if(mode==='whip'){ctx.strokeStyle='#49392a';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x+18,y-35);ctx.quadraticCurveTo(x+55,y-85,x+65,y-38);ctx.stroke();}
  }
  destroy(){this.image.onload=null;this.redraw=()=>{};}
}
