// Audio stays in the audio thread. Only transient measurements leave this class.
export class SlapDetector {
  constructor(sampleRate=48000, sensitivity=3) {
    this.sampleRate=sampleRate; this.sensitivity=sensitivity;
    this.samples=0; this.baseline=.003; this.previous=.003; this.low=0;
    this.suppressedUntil=0; this.candidate=null;
    this.alpha=1-Math.exp(-2*Math.PI*500/sampleRate);
  }
  suppress(seconds=2.5) { this.suppressedUntil=this.samples/this.sampleRate+seconds; this.candidate=null; }
  push(frame) {
    let energy=0, lowEnergy=0, peak=0;
    for(const sample of frame) {
      energy+=sample*sample; peak=Math.max(peak,Math.abs(sample));
      this.low+=this.alpha*(sample-this.low); lowEnergy+=this.low*this.low;
    }
    const rms=Math.sqrt(energy/frame.length), now=(this.samples+=frame.length)/this.sampleRate;
    const bass=lowEnergy/Math.max(energy,1e-12), crest=peak/Math.max(rms,1e-9);
    const level=Math.max(1,Math.min(5,this.sensitivity));
    const floor=[0,.035,.026,.018,.012,.008][level], factor=6.5-level*.6;
    let event=null;
    if(now<1.2 || now<this.suppressedUntil) {
      this.candidate=null;
      this.baseline=.99*this.baseline+.01*Math.min(rms,.025);
    } else if(this.candidate) {
      const c=this.candidate;
      if(rms>c.rms) {c.rms=rms;c.bass=bass;}
      c.crest=Math.max(c.crest,crest);
      c.quiet=rms<c.rms*.4?c.quiet+1:0;
      const duration=now-c.started;
      if(c.quiet>=2 || duration>.16) {
        if(duration<=.16 && c.crest>=1.55 && c.bass>=.12) {
          event={rms:c.rms,strength:Math.min(1,c.rms/.15),durationMs:Math.round(duration*1000)};
          this.suppress(2.6);
        }
        this.candidate=null;
      }
    } else if(rms>Math.max(floor,this.baseline*factor) && peak>floor*2 && rms>this.previous*1.9) {
      this.candidate={started:now,rms,crest,bass,quiet:0};
    } else this.baseline=.995*this.baseline+.005*Math.min(rms,.08);
    this.previous=rms;
    return event;
  }
}
