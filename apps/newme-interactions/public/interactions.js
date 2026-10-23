const SOUNDS={pain:['cartoon-pain-1.wav','cartoon-pain-2.wav'],applause:['applause.wav']};
export class NewmeInteractions extends EventTarget {
  constructor({volume=.35,sensitivity=3}={}) {
    super();this.volume=volume;this.sensitivity=sensitivity;this.muted=false;this.context=null;this.cache=new Map();this.playing=new Set();this.generation=0;this.stream=null;this.nodes=[];this.active=false;this.next=0;this.lastSound=-Infinity;
  }
  emit(type,detail={}){this.dispatchEvent(new CustomEvent(type,{detail}));}
  async unlock() {this.context||=new AudioContext();if(this.context.state!=='running')await this.context.resume();}
  async play(kind) {
    if(!SOUNDS[kind])throw Error('Unknown sound');
    if(this.muted||this.volume<=0||performance.now()-this.lastSound<550)return false;
    this.lastSound=performance.now();this.worklet?.port.postMessage({type:'suppress',seconds:2.8});
    await this.unlock();
    const names=SOUNDS[kind],name=names[this.next++%names.length];
    if(!this.cache.has(name))this.cache.set(name,(async()=>{const response=await fetch(new URL(`./sounds/${name}`,import.meta.url));if(!response.ok)throw Error('Sound unavailable');return this.context.decodeAudioData(await response.arrayBuffer());})());
    let buffer;try{buffer=await this.cache.get(name);}catch(error){this.cache.delete(name);throw error;}
    if(this.muted||this.volume<=0)return false;
    const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;gain.gain.value=Math.max(0,Math.min(1,this.volume));source.connect(gain).connect(this.context.destination);
    this.playing.add(source);source.onended=()=>{this.playing.delete(source);source.disconnect();gain.disconnect();};source.start();this.emit('sound',{kind,name});return true;
  }
  setMuted(value){this.muted=Boolean(value);if(this.muted)for(const source of this.playing){try{source.stop();}catch{}}}
  setSensitivity(value){this.sensitivity=Math.max(1,Math.min(5,Number(value)||3));this.worklet?.port.postMessage({type:'sensitivity',value:this.sensitivity});}
  async startMicrophone() {
    if(this.active||this.starting)return;this.starting=true;
    const generation=++this.generation;
    let stream;
    try {
      await this.unlock();
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1},video:false});
      if(generation!==this.generation){stream.getTracks().forEach(track=>track.stop());return;}
      this.stream=stream;
      this.workletReady||=this.context.audioWorklet.addModule(new URL('./slap-worklet.js',import.meta.url));await this.workletReady;
      if(generation!==this.generation){stream.getTracks().forEach(track=>track.stop());return;}
      const input=this.context.createMediaStreamSource(stream),worklet=new AudioWorkletNode(this.context,'newme-impact'),silent=this.context.createGain();silent.gain.value=0;
      input.connect(worklet).connect(silent).connect(this.context.destination);this.nodes=[input,worklet,silent];this.worklet=worklet;this.setSensitivity(this.sensitivity);
      worklet.port.onmessage=({data})=>{if(!this.active)return;void this.play('pain').catch(error=>this.emit('error',{message:error.message}));this.emit('impact',{strength:data.strength,durationMs:data.durationMs,simulated:false});};
      this.active=true;this.emit('microphone',{active:true});
    }catch(error){stream?.getTracks().forEach(track=>track.stop());if(generation===this.generation)this.stopMicrophone();throw error;}
    finally{if(generation===this.generation)this.starting=false;}
  }
  stopMicrophone() {
    this.generation++;this.starting=false;this.active=false;this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;
    this.nodes.forEach(node=>node.disconnect());this.nodes=[];this.worklet=null;this.emit('microphone',{active:false});
  }
  async whip(){this.emit('action',{kind:'whip'});return this.play('pain');}
  async encourage(){this.emit('action',{kind:'encourage'});return this.play('applause');}
  async testImpact(){this.emit('impact',{simulated:true});return this.play('pain');}
  async destroy(){this.stopMicrophone();this.setMuted(true);await this.context?.close();}
}
