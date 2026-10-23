export function createConnectionGuide(){
  const dialog=document.createElement('dialog');dialog.id='portable-guide';
  dialog.innerHTML=`<form method="dialog"><div class="dialog-heading"><h2>连接自己的任务</h2><button aria-label="关闭">×</button></div></form><p>这套完整办公室独立运行，不要求 GPT 或 Codex。两种视图使用同一份任务，切换不会增减员工。</p>
  <ol><li><strong>手动：</strong>顶部「添加任务」填写名称、状态和部门，点击员工后可编辑。</li><li><strong>JSON 文件：</strong>在启动目录的 <code>.newme-office/tasks.json</code> 发布任务，办公室约两秒刷新一次。格式错误时保留上一份任务并标记未确认。</li><li><strong>命令行：</strong>在应用目录运行 <code>node scripts/tasks.mjs upsert --id my-task --title "我的任务" --status working --role engineering --provider "我的工具"</code>。完成后把状态更新为 done。</li><li><strong>HTTP：</strong>将任务 POST 到 <code>/api/tasks</code>，使用本机 <code>.newme-office/api-token</code> 的 Bearer token。令牌不要放进网页或 Git。</li></ol>
  <p>完整字段、交付内容和反馈适配器见随包的 <code>INTEGRATION.md</code>。工具必须主动发布状态；本应用没有声称已自动监听所有 AI 软件。</p>
  <p id="portable-adapter-state"></p><p>拍击和返工接收器默认独立关闭；挥鞭和鼓励只触发人物动画与声音。</p>`;
  document.body.append(dialog);
  const trigger=document.createElement('button');trigger.id='portable-connect';trigger.className='quiet-button';trigger.textContent='任务接入';document.querySelector('.header-tools').prepend(trigger);trigger.onclick=()=>void open();
  async function open(){try{const r=await fetch('/api/connection');const info=await r.json();dialog.querySelector('#portable-adapter-state').textContent=info.feedbackMode==='webhook'?'返工反馈：已配置接收器；接受请求不代表已经执行。':'返工反馈：仅本机记录，尚未连接外部工具。';}catch{}dialog.showModal();}
  return {open,refreshText(){const button=document.querySelector('#connection-guide-open');if(button)button.textContent='任务接入';},destroy(){dialog.remove();trigger.remove();}};
}
