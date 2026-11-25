import assert from "node:assert/strict"
import {
  defaultWatermarkSettings,
  normalizeJobWatermarks,
  normalizeWatermarkSettingsList,
  serializeWatermarkList,
  staggerWatermarkPosition,
  stripLayerId,
  toWatermarkLayer,
  WATERMARK_MAX_PER_JOB,
  WATERMARK_OPACITY_MIN,
  WATERMARK_SCALE_MAX,
  WATERMARK_SCALE_MIN,
  type JobWatermark,
  type WatermarkSettings,
} from "./watermark.ts"

const makeSettings = (id: string, overrides: Partial<WatermarkSettings> = {}): WatermarkSettings => ({
  watermarkId: id,
  x: 0.5,
  y: 0.5,
  scale: 0.2,
  opacity: 0.85,
  ...overrides,
})

const makeJobWatermark = (id: string, overrides: Partial<JobWatermark> = {}): JobWatermark => ({
  ...makeSettings(id),
  filePath: `/tmp/${id}.png`,
  mimeType: "image/png",
  ...overrides,
})

// 1. Constant check
assert.equal(WATERMARK_MAX_PER_JOB, 5)

// 2. normalizeWatermarkSettingsList
assert.deepEqual(normalizeWatermarkSettingsList(null), [])
assert.deepEqual(normalizeWatermarkSettingsList(undefined), [])

const singleNormalized = normalizeWatermarkSettingsList(
  makeSettings("wm-1", { x: -0.4, y: 1.8, scale: 0.001, opacity: 0.01 }),
)
assert.equal(singleNormalized.length, 1)
assert.deepEqual(singleNormalized[0], {
  watermarkId: "wm-1",
  x: 0,
  y: 1,
  scale: WATERMARK_SCALE_MIN,
  opacity: WATERMARK_OPACITY_MIN,
})

const sevenSettings = Array.from({ length: 7 }, (_, i) => makeSettings(`wm-${i + 1}`, { scale: 2 }))
const cappedSettings = normalizeWatermarkSettingsList(sevenSettings)
assert.equal(cappedSettings.length, WATERMARK_MAX_PER_JOB)
assert.equal(cappedSettings[0].watermarkId, "wm-1")
assert.equal(cappedSettings[4].watermarkId, "wm-5")
assert.equal(cappedSettings[4].scale, WATERMARK_SCALE_MAX)

// 3. normalizeJobWatermarks
assert.deepEqual(normalizeJobWatermarks(null), [])
assert.deepEqual(normalizeJobWatermarks(undefined), [])

const singleJob = makeJobWatermark("wm-job-1")
assert.deepEqual(normalizeJobWatermarks(singleJob), [singleJob])

const sevenJobWatermarks = Array.from({ length: 7 }, (_, i) => makeJobWatermark(`wm-job-${i + 1}`))
const cappedJob = normalizeJobWatermarks(sevenJobWatermarks)
assert.equal(cappedJob.length, WATERMARK_MAX_PER_JOB)
assert.equal(cappedJob[0].watermarkId, "wm-job-1")
assert.equal(cappedJob[4].watermarkId, "wm-job-5")

// 4. toWatermarkLayer & stripLayerId
const layerA = toWatermarkLayer(makeSettings("wm-dup"))
const layerB = toWatermarkLayer(makeSettings("wm-dup"))
assert.ok(layerA.layerId.length > 0)
assert.ok(layerB.layerId.length > 0)
assert.notEqual(layerA.layerId, layerB.layerId)

const explicitLayer = toWatermarkLayer(makeSettings("wm-x", { x: 1.5 }), "custom-layer-id")
assert.equal(explicitLayer.layerId, "custom-layer-id")
assert.equal(explicitLayer.x, 1)

const stripped = stripLayerId(explicitLayer)
assert.equal("layerId" in stripped, false)
assert.deepEqual(stripped, {
  watermarkId: "wm-x",
  x: 1,
  y: 0.5,
  scale: 0.2,
  opacity: 0.85,
})

// 5. serializeWatermarkList (0, 1, 2..5, >5 cap, strips layerId)
assert.equal(serializeWatermarkList([]), null)

const serializedSingle = serializeWatermarkList([explicitLayer])
assert.equal(Array.isArray(serializedSingle), false)
assert.equal(serializedSingle !== null && "layerId" in serializedSingle, false)
assert.deepEqual(serializedSingle, stripped)

const twoLayers = [
  toWatermarkLayer(makeSettings("wm-1", { x: 0.2, y: 0.2 }), "l1"),
  toWatermarkLayer(makeSettings("wm-2", { x: 0.8, y: 0.8 }), "l2"),
]
const serializedTwo = serializeWatermarkList(twoLayers)
assert.equal(Array.isArray(serializedTwo), true)
assert.equal(Array.isArray(serializedTwo) ? serializedTwo.length : 0, 2)
if (Array.isArray(serializedTwo)) {
  assert.equal("layerId" in serializedTwo[0], false)
  assert.equal("layerId" in serializedTwo[1], false)
  assert.equal(serializedTwo[0].watermarkId, "wm-1")
  assert.equal(serializedTwo[1].watermarkId, "wm-2")
}

const sixLayers = Array.from({ length: 6 }, (_, i) => toWatermarkLayer(makeSettings(`wm-${i + 1}`), `l-${i + 1}`))
const serializedCapped = serializeWatermarkList(sixLayers)
assert.equal(Array.isArray(serializedCapped), true)
assert.equal(Array.isArray(serializedCapped) ? serializedCapped.length : 0, WATERMARK_MAX_PER_JOB)
if (Array.isArray(serializedCapped)) {
  assert.equal(serializedCapped[4].watermarkId, "wm-5")
  for (const item of serializedCapped) {
    assert.equal("layerId" in item, false)
  }
}

// 6. Stagger positions for layers 1..5 are distinct
const positions = [0, 1, 2, 3, 4].map((idx) => staggerWatermarkPosition(idx))
const uniqueKeys = new Set(positions.map((p) => `${p.x},${p.y}`))
assert.equal(uniqueKeys.size, 5)
const def0 = defaultWatermarkSettings("wm-1", 0)
const def1 = defaultWatermarkSettings("wm-2", 1)
assert.notDeepEqual({ x: def0.x, y: def0.y }, { x: def1.x, y: def1.y })

console.log("watermark self-check passed")
