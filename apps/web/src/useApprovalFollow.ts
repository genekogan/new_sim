import {useEffect} from 'react';
import type {WorldViewerHandle,WorldViewerState} from './WorldViewer.ts';

/** Approval confirms server readiness; playback can still depict an older take. */
export function useApprovalFollow(pending:{soulId:string;scope:string}|null,scope:string,authed:boolean,handle:WorldViewerHandle|null,state:WorldViewerState|null,complete:(followed:boolean)=>void){
  useEffect(()=>{
    if(!pending)return;
    if(pending.scope!==scope||!authed){complete(false);return;}
    if(state?.presentation==='live'&&state.cameraMode==='follow'&&state.selection.soulId===pending.soulId&&handle?.canFollowSoul?.(pending.soulId)){complete(true);return;}
    const attempt=()=>{
      if(handle?.canFollowSoul?.(pending.soulId)&&handle.selectSoul(pending.soulId))handle.setCameraMode('follow');
    };
    attempt();
    const timer=setInterval(attempt,500);
    return()=>clearInterval(timer);
  },[pending,scope,authed,handle,state]);
}
