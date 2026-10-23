import test from 'node:test';
import assert from 'node:assert/strict';
import {NewmeInteractions} from '../public/interactions.js';
test('whip and encourage are actions rather than physical dissatisfaction events',async()=>{
  const kit=new NewmeInteractions(),actions=[],impacts=[],sounds=[];kit.play=async kind=>sounds.push(kind);
  kit.addEventListener('action',event=>actions.push(event.detail.kind));kit.addEventListener('impact',event=>impacts.push(event.detail));
  await kit.whip();await kit.encourage();assert.deepEqual(actions,['whip','encourage']);assert.deepEqual(sounds,['pain','applause']);assert.equal(impacts.length,0);
  await kit.testImpact();assert.equal(impacts.length,1);assert.equal(impacts[0].simulated,true);
});
test('stop while microphone permission is pending immediately releases a late stream',async()=>{
  const previousNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),previousContext=globalThis.AudioContext;
  let resolveStream,stopped=0;
  globalThis.AudioContext=class{state='running';};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>new Promise(resolve=>{resolveStream=resolve;})}}});
  try {
    const kit=new NewmeInteractions(),starting=kit.startMicrophone();await new Promise(resolve=>setImmediate(resolve));
    kit.stopMicrophone();resolveStream({getTracks:()=>[{stop(){stopped++;}}]});await starting;
    assert.equal(stopped,1);assert.equal(kit.active,false);assert.equal(kit.stream,null);
  }finally{if(previousNavigator)Object.defineProperty(globalThis,'navigator',previousNavigator);else delete globalThis.navigator;globalThis.AudioContext=previousContext;}
});
