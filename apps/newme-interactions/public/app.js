import {NewmeInteractions} from './interactions.js';
const $=id=>document.getElementById(id);
const kit=new NewmeInteractions();let timer,feedbackBusy=false;
const status=message=>{$('status').textContent=message;};
function animate(kind){clearTimeout(timer);$('stage').dataset.action='idle';requestAnimationFrame(()=>{$('stage').dataset.action=kind;timer=setTimeout(()=>{$('stage').dataset.action='idle';},1800);});}
kit.addEventListener('microphone',({detail})=>{$('microphone').textContent=detail.active?'停止识别':'开启拍击识别';$('microphone').setAttribute('aria-pressed',String(detail.active));status(detail.active?'识别中。只在本机分析，不保存、不上传音频。':'识别已停止。');});
kit.addEventListener('action',({detail})=>{animate(detail.kind);status(detail.kind==='whip'?'催工：鞭响与惨叫。':'鼓励：鼓掌。');});
kit.addEventListener('error',({detail})=>status(detail.message));
kit.addEventListener('impact',({detail})=>{animate('whip');if(detail.simulated){status('模拟拍击，只演示声音和动画。');return;}status('识别到短促冲击声。');if($('feedback-auto').checked)void feedback();});
$('microphone').onclick=async()=>{if(kit.active||kit.starting){kit.stopMicrophone();return;}try{await kit.startMicrophone();}catch(error){status(error.name==='NotAllowedError'?'麦克风未获允许；可继续用按钮体验。':`启动失败：${error.message}`);}};
for(const [id,action] of [['whip',()=>kit.whip()],['encourage',()=>kit.encourage()],['test',()=>kit.testImpact()]])$(id).onclick=()=>{void action().catch(error=>status(error.message));};
$('mute').onchange=()=>kit.setMuted($('mute').checked);
$('volume').oninput=()=>{kit.volume=Number($('volume').value)/100;$('volume-value').value=$('volume').value+'%';if(kit.volume===0){kit.setMuted(true);}else kit.setMuted($('mute').checked);};
$('sensitivity').oninput=()=>{kit.setSensitivity($('sensitivity').value);$('sensitivity-value').value=$('sensitivity').value+'/5';};
async function feedback(){
  if(feedbackBusy)return;feedbackBusy=true;$('send').disabled=true;
  const id=crypto.randomUUID();
  try {
    const response=await fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json','X-Newme-Action':'feedback'},body:JSON.stringify({id,message:$('feedback-message').value.trim()})});
    const result=await response.json();
    $('feedback-status').textContent=result.status==='local-only'?'本地示例已接收；没有通知任何 AI。':result.status==='accepted-by-adapter'?'接收器已接受。AI 是否返工，需在接收工具中核对。':result.status==='unknown'?'发送结果未知，请检查接收器；不会自动重发。':'没有送达，请检查配置或返工要求。';
  }catch{$('feedback-status').textContent='发送结果未知，请检查接收器；不会自动重发。';}
  finally{feedbackBusy=false;$('send').disabled=false;}
}
$('send').onclick=()=>void feedback();
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('feedback-message').value);$('feedback-status').textContent='返工要求已复制，可粘贴到自己的 AI 工具。';}catch{$('feedback-message').focus();$('feedback-message').select();$('feedback-status').textContent='请手动复制选中的文字。';}};
fetch('/api/health').then(response=>response.json()).then(value=>{$('feedback-mode').textContent=value.feedbackMode==='webhook'?'已配置接收器':'当前为本地示例；按接入说明配置接收器后才能通知你的工具。';}).catch(()=>{});
window.addEventListener('pagehide',()=>{clearTimeout(timer);void kit.destroy();});
