import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const out=path.resolve(root,'..','public','sounds');
await mkdir(out,{recursive:true});
const rate=44100;
function resonator(freq,bandwidth) {
  const r=Math.exp(-Math.PI*bandwidth/rate),a=2*r*Math.cos(2*Math.PI*freq/rate),b=-r*r,g=1-r;
  let p=0,q=0;return x=>{const y=g*x+a*p+b*q;q=p;p=y;return y;};
}
function make(variant) {
  const seconds=variant?1.36:1.1,n=Math.floor(seconds*rate),data=new Float64Array(n);
  let seed=4318+variant;
  const noise=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2147483648-1;};
  // Dry comic whip crack, with no voice or breath samples.
  for(let i=0;i<rate*.095;i++) {
    const t=i/rate;data[i]+=.65*noise()*Math.exp(-t*80)+.34*Math.sin(2*Math.PI*(2000*t-6500*t*t))*Math.exp(-t*110);
  }
  const syllables=variant?[[.115,.47,520,135],[.66,.52,570,170]]:[[.105,.74,620,125]];
  for(const [start,length,high,low] of syllables) {
    const f1=resonator(850,190),f2=resonator(1450,260),f3=resonator(2900,500);
    let phase=0;
    for(let j=0;j<length*rate;j++) {
      const t=j/rate,u=t/length;
      const pitch=(low+(high-low)*Math.pow(1-u,1.6))*(1+.025*Math.sin(2*Math.PI*37*t)+.012*noise());
      phase+=pitch/rate;phase-=Math.floor(phase);
      const source=(2*phase-1)*.85+.10*noise();
      const formant=f1(source)*2.4+f2(source)*1.8+f3(source)*.7;
      const envelope=Math.min(1,t/.012)*Math.pow(Math.min(1,(1-u)*4),.8)*(.86+.14*Math.sin(2*Math.PI*19*t));
      const value=Math.tanh(7*formant+.27*source)*envelope;
      const index=Math.floor(start*rate)+j;if(index<n)data[index]+=.76*value;
    }
  }
  let peak=0;for(const value of data)peak=Math.max(peak,Math.abs(value));
  const wav=Buffer.alloc(44+n*2);wav.write('RIFF',0);wav.writeUInt32LE(36+n*2,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(n*2,40);
  for(let i=0;i<n;i++)wav.writeInt16LE(Math.round(data[i]/Math.max(peak,1)*.90*32767),44+i*2);
  return wav;
}
for(let i=0;i<2;i++)await writeFile(path.join(out,`cartoon-pain-${i+1}.wav`),make(i));
await writeFile(path.join(out,'cartoon-pain-LICENSE.txt'),'NEWME cartoon pain effects. Procedurally synthesized: whip crack and formant robot yelp. No human voice recordings. CC0-1.0.\n');
// Several independent dry hand-clap bursts with a short room tail, no audience voices.
{
  const seconds=2.15,n=Math.floor(seconds*rate),channels=[new Float64Array(n),new Float64Array(n)];
  let seed=1997;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  for(let hand=0;hand<7;hand++)for(let clap=0;clap<7;clap++) {
    const start=.03+clap*(.21+hand*.004)+random()*.075;
    const pan=.15+random()*.7,strength=(.2+random()*.25)*(clap>4?.75:1);
    let low=0;
    for(let j=0;j<rate*.17;j++) {
      const t=j/rate,noise=random()*2-1;low=.7*low+.3*noise;
      const transient=(noise-low*.6)*(Math.exp(-t*75)+.22*Math.exp(-t*22));
      const sample=transient*strength,at=Math.floor(start*rate)+j;
      if(at<n){channels[0][at]+=sample*(1-pan);channels[1][at]+=sample*pan;}
      for(const [delay,gain] of [[.024,.2],[.047,.12],[.081,.07]]) {
        const echo=at+Math.round(delay*rate);if(echo<n){channels[0][echo]+=sample*gain*pan;channels[1][echo]+=sample*gain*(1-pan);}
      }
    }
  }
  let peak=0;for(const channel of channels)for(const sample of channel)peak=Math.max(peak,Math.abs(sample));
  const wav=Buffer.alloc(44+n*4);wav.write('RIFF',0);wav.writeUInt32LE(36+n*4,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(n*4,40);
  for(let i=0;i<n;i++)for(let channel=0;channel<2;channel++)wav.writeInt16LE(Math.round(channels[channel][i]/Math.max(.5,peak)*.85*32767),44+i*4+channel*2);
  await writeFile(path.join(out,'applause.wav'),wav);
}
