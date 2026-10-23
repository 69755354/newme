import test from 'node:test';
import assert from 'node:assert/strict';
import {SlapDetector} from '../public/slap-detector.js';
function feed(detector,seconds,fn){const events=[];for(let i=0;i<Math.ceil(seconds*48000/128);i++){const event=detector.push(Float32Array.from({length:128},(_,j)=>fn((i*128+j)/48000)));if(event)events.push(event);}return events;}
const ambient=t=>.0015*Math.sin(2*Math.PI*180*t);
const impulse=t=>t<.045?.2*Math.exp(-t*95)*(Math.sin(2*Math.PI*190*t)+.4*Math.sin(2*Math.PI*710*t)):ambient(t);
test('short damped impulse is a positive control after warmup',()=>{const d=new SlapDetector();feed(d,1.5,ambient);assert.equal(feed(d,.3,impulse).length,1);});
test('sustained voice-like tones and small high-frequency keyboard impulses are rejected',()=>{const d=new SlapDetector();feed(d,1.5,ambient);assert.equal(feed(d,2,t=>.055*Math.sin(2*Math.PI*160*t)).length,0);assert.equal(feed(d,2,t=>ambient(t)+(t%.15<.002?.009*Math.sin(2*Math.PI*3500*t):0)).length,0);});
test('speaker suppression expires without permanently disabling the detector',()=>{const d=new SlapDetector();feed(d,1.5,ambient);d.suppress(3);assert.equal(feed(d,.3,impulse).length,0);feed(d,3.1,ambient);assert.equal(feed(d,.3,impulse).length,1);});
