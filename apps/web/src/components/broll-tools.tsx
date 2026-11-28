import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { MediaAssetResponse, PrimaryMediaSource } from '@/lib/split-screen'
import { useSplitText } from './media-source-picker'
import { Button } from './ui/button'
import { Input } from './ui/input'

type Range = {startSec:number; endSec:number; reason?:string}
type Props = {source:PrimaryMediaSource; duration:number; select:(source:PrimaryMediaSource & Partial<Range>)=>void}

export function BrollTools({source,duration,select}:Props) {
  const t=useSplitText(), client=useQueryClient()
  const [action,setAction]=useState<'generate'|'capture'|'moment'|null>(null)
  const [prompt,setPrompt]=useState(''), [time,setTime]=useState('0')
  const {kind,url,mediaId,clipId}=source
  const video=source.mediaType!=='image' && (kind==='url' ? /^https?:\/\//i.test(url??'') : kind==='upload'? !!mediaId:!!clipId)
  const run=useMutation({mutationFn:async()=>{
    const post=(body:object)=>({method:'POST',body:JSON.stringify(body)})
    if(action==='moment') {
      const r=await api<Range>('/media/find-moment',post({kind,url,mediaId,clipId,prompt:prompt.trim(),targetDurationSec:duration}))
      select({...source,startSec:r.startSec,endSec:r.endSec})
    } else {
      const asset=action==='capture' ? await api<MediaAssetResponse>('/media/capture-frame',post({kind,url,mediaId,clipId,atSec:Number(time)})) : await api<MediaAssetResponse>('/media/generate-image',post({prompt:prompt.trim(),aspectRatio:'16:9'}))
      select({kind:'upload',mediaType:'image',mediaId:asset.id,label:asset.name})
      void client.invalidateQueries({queryKey:['media']})
    }
    setAction(null)
  }})
  return <fieldset className="space-y-2" disabled={run.isPending}><div className="flex flex-wrap gap-1">{(['generate','capture','moment'] as const).map(k=><Button type="button" size="sm" variant={action===k?'secondary':'outline'} key={k} aria-pressed={action===k} disabled={k!=='generate'&&!video} onClick={()=>{run.reset();setAction(action===k?null:k);setPrompt('')}}>{t[k]}</Button>)}</div>
    {action && <div className="space-y-2 border-l-2 pl-2"><label className="block text-xs">{action==='capture'?t.seconds:action==='generate'?t.imagePrompt:t.momentPrompt}{action==='capture'?<Input type="number" min={0} step="any" value={time} onChange={e=>setTime(e.target.value)}/>:<Input value={prompt} maxLength={1000} onChange={e=>setPrompt(e.target.value)}/>}</label>
    <Button size="sm" type="button" disabled={action==='capture'? !video||time===''||Number(time)<0:!prompt.trim()||(action==='moment'&&!video)} onClick={()=>run.mutate()}>{run.isPending?t.working:t[action]}</Button>{run.isError&&<p role="alert" className="text-xs">{run.error.message||t.failed}</p>}</div>}
  </fieldset>
}
