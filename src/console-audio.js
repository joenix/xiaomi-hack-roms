// Local mechanical detents; no audio downloads or autoplay.
export function createConsoleAudio(){
 let context;
 return {
  unlock(){try{const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)return;context ||= new Audio();if(context.state==='suspended')void context.resume().catch(()=>{});}catch{}},
  tick(gear=false){
   if(!context||context.state!=='running')return;
   try{
    const now=context.currentTime;
    for(let i=0;i<(gear?3:1);i++){
     const start=now+i*.025,osc=context.createOscillator(),gain=context.createGain(),filter=context.createBiquadFilter();
     osc.type='triangle';osc.frequency.setValueAtTime(gear?210-i*28:420,start);osc.frequency.exponentialRampToValueAtTime(gear?70:150,start+.045);
     filter.type='lowpass';filter.frequency.value=gear?1300:2200;
     gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(gear?.075:.06,start+.003);gain.gain.exponentialRampToValueAtTime(.0001,start+.055);
     osc.connect(filter);filter.connect(gain);gain.connect(context.destination);osc.start(start);osc.stop(start+.06);
    }
   }catch{}
  },
  close(){if(context)void context.close().catch(()=>{});}
 };
}
