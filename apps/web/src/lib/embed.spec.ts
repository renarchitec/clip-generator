import assert from "node:assert/strict"
import { getVideoEmbed } from "./embed.ts"

assert.equal(getVideoEmbed("https://youtu.be/dQw4w9WgXcQ")?.src, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")
assert.equal(getVideoEmbed("https://m.youtube.com/shorts/dQw4w9WgXcQ")?.src, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")
assert.equal(getVideoEmbed("https://www.tiktok.com/@maker/video/123456789")?.src, "https://www.tiktok.com/player/v1/123456789")
assert.equal(getVideoEmbed("https://www.instagram.com/reel/AbCdEf/")?.src, "https://www.instagram.com/p/AbCdEf/embed")
assert.equal(getVideoEmbed("https://example.com/video"), null)
assert.equal(getVideoEmbed(""), null)
console.log("embed URL self-check passed")
