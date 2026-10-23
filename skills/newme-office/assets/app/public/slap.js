const SOUNDS=['cartoon-pain-1.wav','cartoon-pain-2.wav'];
const KEY='newme.slap.v1';
const DEFAULT_PROMPT='我对刚才的工作结果不满意。请重新对照我原来的目标和最近的要求，检查是否漏项、敷衍或没有实际验证，继续修正并核验结果。不要只解释或道歉，不要擅自扩大范围；信息不足时只问最关键的问题。';

export function createSlapControls({getView,onDraft,onSlap}) {
  let prefs={};try{prefs=JSON.parse(localStorage.getItem(KEY))||{};}catch{}
  let context=null,stream=null,input=null,worklet=null,silent=null,active=false,starting=false;
  let buffers=[],applause=null,soundIndex=0,lastSound=-Infinity,calibrating=false,samples=[];
  const playing=new Set();
  let pending=prefs.pending||null,sending=false,destroyed=false,micGeneration=0;
  const enabledByHost=false; // Public installations require their own explicit microphone action.
  const button=document.createElement('button');button.id='slap-open';button.className='quiet-button slap-entry';button.textContent='拍击 · 关';
  document.querySelector('.header-tools').prepend(button);
  const dialog=document.createElement('dialog');dialog.id='slap-dialog';dialog.className='slap-dialog';
  dialog.innerHTML=`<div class="slap-title"><div><h2>拍一下，叫一声</h2><p>电脑会叫，也会记下你的不满意。</p></div><button type="button" id="slap-close" aria-label="关闭">×</button></div>
    <label class="slap-row"><span>拍击识别 <small>麦克风仅在本机分析，关闭办公室即停止</small></span><input id="slap-enabled" type="checkbox"></label>
    <p id="slap-mic-status" role="status">麦克风未开启</p>
    <label class="slap-row"><span>互动声音 <small>拍击、挥鞭和鼓励共用</small></span><input id="slap-sound" type="checkbox"></label>
    <label class="slap-row"><span>音量</span><input id="slap-volume" type="range" min="0" max="100" step="5"><output id="slap-volume-value"></output></label>
    <label class="slap-row"><span>灵敏度</span><input id="slap-sensitivity" type="range" min="1" max="5" step="1"><output id="slap-sensitivity-value"></output></label>
    <div class="slap-actions"><button type="button" id="slap-test">试听嗷嗷叫</button><button type="button" id="slap-test-applause">试听掌声</button><button type="button" id="slap-calibrate">校准轻拍</button></div>
    <div class="slap-feedback"><h3>不满意，返工</h3><label>关联任务<select id="slap-target"><option value="">只叫一声，暂不关联任务</option></select></label>
    <textarea id="slap-prompt" rows="4" aria-label="返工要求"></textarea>
    <label class="slap-auto"><input id="slap-auto" type="checkbox">拍击后自动发送返工要求；任务进行中则等它结束</label>
    <div class="slap-actions"><button type="button" id="slap-draft">修改并发送返工要求</button><button type="button" id="slap-cancel" hidden>取消待发</button></div></div>
    <p id="slap-event-status" role="status">挥鞭时惨叫，鼓励时鼓掌；这两个动作只播放音效。</p>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#'+id);
  const mic=$('slap-enabled'),micStatus=$('slap-mic-status'),sound=$('slap-sound'),volume=$('slap-volume'),sensitivity=$('slap-sensitivity'),target=$('slap-target'),prompt=$('slap-prompt'),auto=$('slap-auto'),status=$('slap-event-status');
  sound.checked=prefs.sound!==false;volume.value=String(prefs.volume??35);sensitivity.value=String(prefs.sensitivity??3);prompt.value=prefs.prompt||DEFAULT_PROMPT;
  auto.checked=prefs.auto===true; target.dataset.saved=prefs.target||'';
  const save=()=>{
    prefs={...prefs,sound:sound.checked,volume:Number(volume.value),sensitivity:Number(sensitivity.value),prompt:prompt.value,target:target.value,auto:auto.checked,pending};
    try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch{}
  };
  function ranges() {$('slap-volume-value').value=volume.value+'%';$('slap-sensitivity-value').value=sensitivity.value+'/5';}
  ranges();
  const say=text=>{status.textContent=text;button.title=text;};
  function trace(kind,detail={}) {
    const event={kind,...detail};
    button.dataset.lastEvent=kind;
    if(kind==='sound-started')button.dataset.lastSound=detail.reason;
    document.dispatchEvent(new CustomEvent('newme:slap-status',{detail:event}));
    if(globalThis.newmeDesktop)globalThis.chrome?.webview?.postMessage({type:'slap-status',...event});
  }
  async function audio() {
    context ||= new AudioContext();
    if(context.state!=='running') await context.resume();
    if(!buffers.length) buffers=await Promise.all(SOUNDS.map(async name=>{
      const r=await fetch('/assets/slap/'+name);if(!r.ok)throw Error('音效暂时不可用');
      return context.decodeAudioData(await r.arrayBuffer());
    }));
  }
  async function play(kind='slap') {
    if(!sound.checked || Number(volume.value)===0)return false;
    if(performance.now()-lastSound<550)return false;
    lastSound=performance.now();
    try {
      worklet?.port.postMessage({type:'suppress',seconds:2.8});
      await audio();
      const source=context.createBufferSource(),gain=context.createGain();
      let clip;
      if(kind==='encourage'||kind==='applause-preview') {
        if(!applause){const response=await fetch('/assets/slap/applause.wav');if(!response.ok)throw Error('掌声暂时不可用');applause=await context.decodeAudioData(await response.arrayBuffer());}
        source.buffer=applause;clip='applause.wav';
      }else{const index=soundIndex++%buffers.length;source.buffer=buffers[index];clip=SOUNDS[index];}
      if(!sound.checked || Number(volume.value)===0)return false;
      gain.gain.value=Number(volume.value)/100;
      source.connect(gain).connect(context.destination);playing.add(source);source.onended=()=>{playing.delete(source);source.disconnect();gain.disconnect();};source.start();
      trace('sound-started',{reason:kind,clip});return true;
    } catch(error){say(error.message||'音效播放失败');trace('sound-failed');return false;}
  }
  async function stop() {
    micGeneration++;
    stream?.getTracks().forEach(track=>track.stop());stream=null;
    input?.disconnect();worklet?.disconnect();silent?.disconnect();input=null;worklet=null;silent=null;
    active=false;mic.checked=false;button.textContent='拍击 · 关';button.dataset.active='false';micStatus.textContent='麦克风未开启';trace('microphone-stopped');
  }
  async function start() {
    if(active||starting||destroyed)return;const generation=++micGeneration;starting=true;mic.disabled=true;
    try {
      await audio();
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1},video:false});
      if(destroyed||generation!==micGeneration){stream.getTracks().forEach(t=>t.stop());stream=null;return;}
      await context.audioWorklet.addModule('/slap-worklet.js');
      if(destroyed||generation!==micGeneration){stream?.getTracks().forEach(t=>t.stop());stream=null;return;}
      input=context.createMediaStreamSource(stream);worklet=new AudioWorkletNode(context,'newme-impact');silent=context.createGain();silent.gain.value=0;
      input.connect(worklet).connect(silent).connect(context.destination);
      worklet.port.postMessage({type:'sensitivity',value:Number(sensitivity.value)});
      worklet.port.onmessage=({data})=>impact(data);
      active=true;mic.checked=true;button.textContent='拍击 · 开';button.dataset.active='true';
      micStatus.textContent='监听中 · 音频不保存、不上传';trace('microphone-started');
    } catch(error) {await stop();micStatus.textContent=error.name==='NotAllowedError'?'麦克风未获允许，可在浏览器提示中手动允许':'麦克风未启动：'+(error.message||error.name);trace('microphone-failed',{name:error.name});}
    finally {starting=false;mic.disabled=false;}
  }
  function impact(data) {
    trace('impact-detected',{strength:data.strength});
    if(calibrating) {
      samples.push(data.rms);say(`轻拍校准 ${samples.length}/3`);
      if(samples.length>=3) {calibrating=false;const average=samples.reduce((a,b)=>a+b,0)/samples.length;sensitivity.value=average<.03?'5':average<.06?'4':'3';ranges();worklet.port.postMessage({type:'sensitivity',value:Number(sensitivity.value)});save();say('校准完成。正常打字试一下，误触时降低灵敏度。');}
      void play('calibration');return;
    }
    void play('slap');onSlap?.();
    const task=getView().tasks.find(task=>task.id===target.value&&!task.sample);
    if(!task){say('嗷！收到不满意。选择关联任务后才能发送返工要求。');return;}
    if(!auto.checked){say('嗷！已关联「'+task.title+'」，返工要求待你发送。');return;}
    if(pending){say('已有一条返工要求待发，不会重复堆积。');return;}
    pending={requestId:crypto.randomUUID(),taskId:task.id,text:prompt.value.trim()||DEFAULT_PROMPT,state:'queued'};save();void flush();
  }
  async function flush() {
    $('slap-cancel').hidden=!pending;
    if(!pending||sending)return;
    if(pending.state==='unknown'){say('返工要求发送结果未知，请先到原聊天核对；不会自动重发。');return;}
    const task=getView().tasks.find(task=>task.id===pending.taskId&&!task.sample);
    if(!task){say('关联任务暂时不可见，返工要求保留待发。');return;}
    if(!['done','idle','error'].includes(task.status)){say('返工要求已排队，当前任务结束后发送。');return;}
    sending=true;pending.state='unknown';save();say('正在发送返工要求…');
    try {
      const r=await fetch('/api/instructions',{method:'POST',headers:{'Content-Type':'application/json','X-Workroom-Action':'instruction'},body:JSON.stringify({taskId:pending.taskId,text:pending.text,requestId:pending.requestId})});
      const result=await r.json();
      if(r.ok&&result.taskId===pending.taskId){say(result.status==='accepted-by-adapter'?'接收器已接受「'+task.title+'」的返工要求，等待工具确认执行。':'返工要求已记录在本机，尚未连接外部 AI 工具。');trace('feedback-accepted',{taskId:result.taskId,turnId:result.turnId});pending=null;}
      else if(result.error==='busy'){pending.state='queued';say('任务仍在进行，返工要求继续等待。');}
      else if(result.error==='outcome_unknown'){say('发送结果未知，请先到原聊天核对。');}
      else {pending=null;auto.checked=false;say('返工要求未送达，请用“修改并发送”手动处理。');trace('feedback-failed',{code:result.code||result.error});}
    }catch{say('发送结果未知，请先到原聊天核对。');}
    finally{sending=false;save();$('slap-cancel').hidden=!pending;}
  }
  function refresh() {
    const tasks=getView().tasks.filter(task=>!task.sample),saved=target.value||target.dataset.saved;
    const key=JSON.stringify(tasks.map(task=>[task.id,task.title]));
    if(key!==target.dataset.key) {
      target.replaceChildren(new Option('只叫一声，暂不关联任务',''));
      for(const task of tasks)target.append(new Option(task.title,task.id));
      if(tasks.some(task=>task.id===saved))target.value=saved;
      else if(saved)target.append(new Option('关联任务暂不可见',saved,true,true));
      target.dataset.key=key;
    }
    $('slap-draft').disabled=!target.value;
    void flush();
  }
  button.onclick=()=>{refresh();dialog.showModal();};$('slap-close').onclick=()=>dialog.close();
  mic.onchange=()=>{prefs.microphone=mic.checked;save();void(mic.checked?start():stop());};
  function silence(){for(const source of playing){try{source.stop();}catch{}}playing.clear();}
  sound.onchange=()=>{if(!sound.checked)silence();save();};volume.oninput=()=>{if(Number(volume.value)===0)silence();ranges();save();};sensitivity.oninput=()=>{ranges();worklet?.port.postMessage({type:'sensitivity',value:Number(sensitivity.value)});save();};
  target.onchange=()=>{target.dataset.saved=target.value;save();refresh();};prompt.onchange=save;auto.onchange=save;
  $('slap-test').onclick=()=>{void play('preview');say('试听仅播放声音，不发送返工要求。');};
  $('slap-test-applause').onclick=()=>{void play('applause-preview');say('掌声试听，不发送返工要求。');};
  $('slap-calibrate').onclick=async()=>{if(!active)await start();if(active){calibrating=true;samples=[];say('请轻拍掌托三次，每次间隔三秒。');}};
  $('slap-draft').onclick=()=>{const task=getView().tasks.find(t=>t.id===target.value);if(!task)return;dialog.close();onDraft(task,prompt.value.trim()||DEFAULT_PROMPT);};
  $('slap-cancel').onclick=()=>{if(sending)return;pending=null;save();$('slap-cancel').hidden=true;say('待发返工要求已取消。');};
  const pageExit=()=>{void stop();};window.addEventListener('pagehide',pageExit);
  if(enabledByHost&&prefs.microphone!==false)void start();
  refresh();
  return {refresh,playWhip:()=>play('whip'),playApplause:()=>play('encourage'),destroy(){destroyed=true;void stop();silence();void context?.close();window.removeEventListener('pagehide',pageExit);dialog.remove();button.remove();}};
}
