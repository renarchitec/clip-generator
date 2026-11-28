import type {SplitScreenConfig} from './split-screen'

type Candidate = {start:number; end:number; title:string; reason:string}
type Cue = {start:number; end:number; text:string}
export function discussionPrompt(candidate:Candidate, cues:Cue[]) {
  const clean=(s:string)=>s.replace(/\s+/g,' ').trim()
  const lines=cues.filter(c=>c.start<candidate.end && c.end>candidate.start && c.end>c.start).map(c=>clean(c.text)).filter(Boolean)
  if (!lines.length || candidate.end<=candidate.start) return null
  const text=lines.join(' ')
  const excerpt=text.length<=900?text:[text.slice(0,300),text.slice(Math.floor(text.length/2)-150,Math.floor(text.length/2)+150),text.slice(-300)].join(' … ')
  return `One illustrative B-roll still for this discussion, without text or collage. Discussion: ${excerpt}\nContext: ${clean(candidate.title).slice(0,80)}. ${clean(candidate.reason).slice(0,120)}`
}
export function reviewImageId(previewId:string,c:Candidate){return `review-${previewId}-${c.start}-${c.end}`}
export function attachReviewImage(split:SplitScreenConfig,id:string,mediaId:string,label:string):SplitScreenConfig {
  if(split.clips.some(c=>c.id===id)||split.clips.length>=10) return split
  return {...split,clips:[...split.clips,{id,kind:'upload',mediaType:'image',mediaId,label:label.slice(0,120)}]}
}
export function imageSegment(id:string,c:Candidate){return [{clipId:id,atStart:0,atEnd:c.end-c.start}]}
