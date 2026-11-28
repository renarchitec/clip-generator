import assert from 'node:assert/strict'
import {discussionPrompt, reviewImageId, attachReviewImage, imageSegment} from './review-image.ts'
import {defaultSplit} from './split-screen.ts'

const clip={start:10,end:20,title:'Comets',reason:'Explains the tail'}
const cues=[{start:8,end:10,text:'unrelated before'},{start:9,end:11,text:'dust'},{start:18,end:22,text:'sunlight'},{start:20,end:23,text:'unrelated after'}]
const prompt=discussionPrompt(clip,cues)!
assert.match(prompt,/dust sunlight/); assert.match(prompt,/Comets/); assert.doesNotMatch(prompt,/unrelated/)
assert.equal(discussionPrompt(clip,[cues[0],cues[3]]),null)
assert.equal(discussionPrompt(clip,[{start:11,end:12,text:'  '}]),null)
assert.ok(discussionPrompt(clip,[{start:10,end:20,text:'topic '.repeat(3000)}])!.length<1300)
const key=reviewImageId('p',clip)
const one=attachReviewImage(defaultSplit,key,'asset','Comets')
assert.deepEqual(imageSegment(key,clip),[{clipId:key,atStart:0,atEnd:10}])
assert.equal(attachReviewImage(one,key,'duplicate','Comets'),one)
const restored=JSON.parse(JSON.stringify(one))
assert.equal(attachReviewImage(restored,key,'duplicate','Comets'),restored)
assert.deepEqual(attachReviewImage(one,'another','asset2','Moon').clips.map(x=>x.mediaId),['asset','asset2'])
console.log('review-image self-check passed')
