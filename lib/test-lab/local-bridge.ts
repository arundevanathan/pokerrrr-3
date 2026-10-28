'use client';
import {buildScenario, labPlayerId, stepSimulation, summary, seededDeck} from './scenarios.mjs';
import {view, tick, command} from '../poker.mjs';
// Installed only by the staging-gated lab table route. Messages cannot target a live table.
export function installLocalLab(options: any) {
  let bundle: any, index=0, now=Date.now(), running=false, replay=false, lastBot=0, replayKey=0;
  const origin=location.origin;
  const post=(extra={})=>{options.playing(running);window.parent.postMessage({type:'lab-state',backend:'local',scenario:bundle?.config.scenario,
    index,total:bundle?.checkpoints.length||0,label:bundle?.checkpoints[index]?.label,now,running,
    expected:bundle?summary(options.demo.current,bundle.config.viewer):null,transcript:bundle?.transcript.filter((entry:any)=>entry.at<=now-bundle.checkpoints[0].now),...extra},origin);};
  const apply=(room:any)=>{room.labReplayKey=replayKey;options.demo.current=room;options.token.current=labPlayerId(bundle.config.viewer);room.labNow=now;
    options.identity({id:options.token.current,name:room.players[bundle.config.viewer].name});options.time(now);
    options.update(view(room,options.token.current,now));post();};
  const point=(next:number)=>{if(next<=index)replayKey++;index=Math.max(0,Math.min(next,bundle.checkpoints.length-1));const p=bundle.checkpoints[index];now=p.now;apply(structuredClone(p.room));};
  const load=(input:any)=>{bundle=buildScenario(input);running=false;replay=false;
    point(bundle.config.scenario==='deal'?0:bundle.checkpoints.length-1);};
  const message=(event:MessageEvent)=>{
    if(event.origin!==origin||event.source!==window.parent||!event.data?.type?.startsWith('lab-'))return;
    try {
      const data=event.data;
      if(data.type==='lab-load')load(data.config);
      if(!bundle)return;
      if(data.type==='lab-point'){running=false;point(Number(data.index));}
      if(data.type==='lab-play'){running=Boolean(data.running);replay=Boolean(data.replay);if(replay){point(0);running=true;}}
      if(data.type==='lab-step'){
        running=false;
        if(index<bundle.checkpoints.length-1)point(index+1);
        else {now+=1000;stepSimulation(options.demo.current,now,bundle.config.seed,['precall-raise','short-call'].includes(bundle.config.scenario));now=Math.max(now,options.demo.current.labNow);apply(options.demo.current);}
      }
      if(data.type==='lab-settle'){running=false;now=Math.max(now,options.demo.current.payoutFinishedAt||now)+1;apply(options.demo.current);}
      if(data.type==='lab-inspect')post();
      post();
    } catch(error:any){post({error:error.message});}
  };
  window.addEventListener('message',message);
  const query=new URLSearchParams(location.search);
  try{load(JSON.parse(query.get('config')||'{}'));}catch(error:any){post({error:error.message});}
  const timer=setInterval(()=>{
    if(!running||!bundle)return;
    try{
      now+=100*bundle.config.speed;options.time(now);
      if(replay){
        const next=bundle.checkpoints[index+1];
        if(next&&now>=next.now){const advanceNow=now;point(index+1);now=Math.max(advanceNow,now);}
        if(index===bundle.checkpoints.length-1){running=false;post();}
        return;
      }
      const room=options.demo.current;
      if(tick(room,now,false))apply(room);
      if(now<room.handStartedAt+(room.dealDuration||0))return;
      if(room.phase==='showdown'&&now<room.payoutFinishedAt)return;
      if(room.phase==='runout_vote'){
        if(now>=room.runVote.opensAt&&now<room.runVote.deadline){for(const voter of room.runVote.voters)if(voter.id!==options.token.current&&voter.choice===null)command(room,voter.id,{type:'runout_vote',choice:room.runVote.canTwice?2:1},now);apply(room);}return;
      }
      if(now-lastBot>850&&room.turn!==options.token.current){lastBot=now;stepSimulation(room,now,bundle.config.seed);now=Math.max(now,room.labNow);apply(room);}
    }catch(error:any){running=false;post({error:error.message});}
  },100);
  const request=(type:string,extra:any={})=>window.parent.postMessage({type,...extra},origin);
  options.runtime.current={get now(){return now;},get seed(){return bundle?.config.seed;},newDeck:(room:any)=>seededDeck(`${bundle.config.seed}:${room.completed}`),record:(type:string,extra:any)=>bundle.transcript.push({at:now-bundle.checkpoints[0].now,seat:bundle.config.viewer,type,...extra}),report:()=>post(),exit:()=>request('lab-exit')};
  return ()=>{clearInterval(timer);window.removeEventListener('message',message);options.runtime.current=null;};
}
