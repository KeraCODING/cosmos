// Runs hand tracking away from the 3D render loop. All model and runtime files are local; frames never leave this worker.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let tracker: HandLandmarker | null = null, last = 0;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
const opts = (c: { detect: number; track: number }) => ({ numHands: 2, minHandDetectionConfidence: c.detect, minHandPresenceConfidence: c.detect, minTrackingConfidence: c.track });
const pack = (r: ReturnType<HandLandmarker['detectForVideo']>) => r.landmarks.map((lm, i) => ({ lm: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })), world: r.worldLandmarks[i]?.map((p) => ({ x: p.x * 5, y: p.y * 5, z: p.z * 5 })), score: r.handedness[i]?.[0]?.score ?? 0 }));

// Evens out exposure and sensor noise before tracking, in memory only.
const probe = new OffscreenCanvas(32, 24), probeCtx = probe.getContext('2d', { willReadFrequently: true })!, work = new OffscreenCanvas(1, 1), workCtx = work.getContext('2d')!;
function prepare(b: ImageBitmap) {
  probeCtx.drawImage(b, 0, 0, 32, 24); const d = probeCtx.getImageData(0, 0, 32, 24).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  const gain = Math.max(0.8, Math.min(2.8, 120 / Math.max(8, sum / 768)));
  if (work.width !== b.width || work.height !== b.height) { work.width = b.width; work.height = b.height; }
  workCtx.filter = `brightness(${gain.toFixed(2)}) saturate(.8) blur(.8px)`; workCtx.drawImage(b, 0, 0); b.close(); return work;
}
async function create(base: string, c: { detect: number; track: number }, delegate: 'GPU' | 'CPU') {
  const vision = await FilesetResolver.forVisionTasks(`${base}mediapipe`, true);
  return HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate }, runningMode: 'VIDEO', ...opts(c) });
}
self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      let delegate: 'GPU' | 'CPU' = 'GPU';
      try { tracker = await create(m.base, m, 'GPU'); } catch { delegate = 'CPU'; tracker = await create(m.base, m, 'CPU'); }
      post({ type: 'ready', delegate });
    } else if (m.type === 'config') { await tracker?.setOptions(opts(m)); }
    else if (m.type === 'frame') {
      const start = performance.now(); last = Math.max(last + 1, m.t);
      const hands = tracker ? pack(tracker.detectForVideo(prepare(m.bitmap), last)) : []; if (!tracker) m.bitmap.close();
      post({ type: 'result', id: m.id, hands, aspect: m.aspect, ms: performance.now() - start });
    } else if (m.type === 'still') {
      await tracker!.setOptions({ runningMode: 'IMAGE' }); const hands = pack(tracker!.detect(prepare(m.bitmap))); await tracker!.setOptions({ runningMode: 'VIDEO' });
      post({ type: 'still', id: m.id, hands });
    }
  } catch (err) { try { m.bitmap?.close?.(); } catch { /* already closed */ } post({ type: 'error', id: m.id, message: String(err) }); }
};
