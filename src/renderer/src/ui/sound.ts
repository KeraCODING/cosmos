import { store } from '../settings/store';

/** Small synthesized interface sounds and an optional quiet ambient tone. No audio files are needed. */
class Sound {
  private ctx?: AudioContext; private master?: GainNode; private amb?: { osc: OscillatorNode[]; gain: GainNode };
  private ensure() {
    if (!this.ctx) { this.ctx = new AudioContext(); this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination); }
    void this.ctx.resume(); return this.ctx;
  }
  sync() {
    const s = store.value; if (!this.ctx && !(s.soundEnabled && s.ambient)) return;
    const c = this.ensure(); this.master!.gain.setTargetAtTime(s.soundEnabled ? s.volume : 0, c.currentTime, 0.05);
    if (s.soundEnabled && s.ambient && !this.amb) {
      const gain = c.createGain(); gain.gain.value = 0; gain.gain.setTargetAtTime(0.05, c.currentTime, 1.2); gain.connect(this.master!);
      this.amb = { gain, osc: [55, 82.4, 110.3].map((f) => { const o = c.createOscillator(); o.frequency.value = f; o.connect(gain); o.start(); return o; }) };
    } else if (this.amb && !(s.soundEnabled && s.ambient)) { const a = this.amb; this.amb = undefined; a.gain.gain.setTargetAtTime(0, c.currentTime, 0.2); a.osc.forEach((o) => o.stop(c.currentTime + 1)); }
  }
  click() {
    if (!store.value.soundEnabled) return; const c = this.ensure(); this.sync();
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(520, t + 0.05);
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07); o.connect(g); g.connect(this.master!); o.start(t); o.stop(t + 0.08);
  }
}
export const sound = new Sound();
