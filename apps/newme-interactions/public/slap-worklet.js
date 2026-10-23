import { SlapDetector } from './slap-detector.js';
class NewmeImpact extends AudioWorkletProcessor {
  constructor() {
    super(); this.detector=new SlapDetector(sampleRate);
    this.port.onmessage=({data})=>{
      if(data.type==='sensitivity') this.detector.sensitivity=data.value;
      if(data.type==='suppress') this.detector.suppress(data.seconds);
    };
  }
  process(inputs,outputs) {
    for(const output of outputs) for(const channel of output) channel.fill(0);
    const frame=inputs[0]?.[0];
    if(frame) {const event=this.detector.push(frame);if(event)this.port.postMessage(event);}
    return true;
  }
}
registerProcessor('newme-impact',NewmeImpact);
