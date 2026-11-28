import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { REACTIONS } from '../lib/reactions.mjs';
const source = readFileSync(new URL('../lib/poker-audio.ts', import.meta.url), 'utf8')
  .replace("'./reactions.mjs'", JSON.stringify(new URL('../lib/reactions.mjs', import.meta.url).href));
const { outputText } = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
const { PokerAudio } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
class Context {
  currentTime = 20; sampleRate = 8000; state = 'running'; destination = {}; sources = [];
  parameter() { return {setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}}; }
  createBuffer(channels, size) { return {getChannelData:() => new Float32Array(size)}; }
  createGain() { return {gain:this.parameter(),connect(){}}; }
  createBiquadFilter() { return {frequency:this.parameter(),Q:{value:0},connect(){}}; }
  node() {
    const node = {frequency:this.parameter(),connect(){},start(at){node.startedAt=at;},stop(at){node.stoppedAt=at;}};
    this.sources.push(node); return node;
  }
  createOscillator() { return this.node(); }
  createBufferSource() { return this.node(); }
}
test('every social sound schedules at its impact, respects mute and cancels pending nodes', () => {
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  try {
    let context;
    globalThis.window = {AudioContext:class extends Context {constructor(){super();context=this;}}};
    globalThis.document = {hidden:false};
    const audio = new PokerAudio(); audio.unlock();
    for (const definition of Object.values(REACTIONS)) {
      const start = context.sources.length;
      audio.play(definition.id, 200);
      const nodes = context.sources.slice(start), impact = 20 + (200 + definition.impactAt) / 1000;
      assert.ok(nodes.length >= 2, `${definition.id} is audible`);
      assert.ok(nodes.some(node => Math.abs(node.startedAt - impact) < .00001), `${definition.id} aligns with contact`);
      assert.ok(nodes.every(node => node.startedAt >= 20.2 && node.stoppedAt > node.startedAt));
    }
    const count = context.sources.length; audio.setEnabled(false); audio.play('cheers');
    assert.equal(context.sources.length, count);
    assert.ok(context.sources.every(node => node.stoppedAt === undefined), 'Mute stops scheduled nodes immediately');
    audio.setEnabled(true); globalThis.document.hidden=true; audio.play('tomato');
    assert.equal(context.sources.length, count, 'Suspended pages stay quiet');
  } finally { globalThis.window=originalWindow; globalThis.document=originalDocument; }
});

test('interrupted audio resumes on foreground or next sound, without replaying stale or muted sounds', async () => {
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  try {
    let context, instances = 0, resumes = 0;
    globalThis.window = {AudioContext:class extends Context {
      constructor(){super();context=this;instances++;}
      async resume(){resumes++;this.state='running';}
    }};
    globalThis.document = {hidden:false};
    const audio = new PokerAudio();
    audio.recover();
    assert.equal(instances, 0, 'No context before a user gesture');
    audio.unlock();
    context.state = 'interrupted';
    audio.recover();
    assert.equal(resumes, 1);
    context.state = 'suspended';
    audio.play('cheers');
    await Promise.resolve();
    assert.ok(context.sources.length > 0);
    const count = context.sources.length;
    context.state = 'interrupted';
    audio.play('cheers');
    audio.setEnabled(false);
    await Promise.resolve();
    assert.equal(context.sources.length, count);
    context.state = 'interrupted';
    audio.recover();
    assert.equal(resumes, 3);
    audio.setEnabled(true);
    globalThis.document.hidden = true;
    audio.recover();
    assert.equal(resumes, 3);
    globalThis.document.hidden = false;
    context.state = 'closed';
    audio.recover();
    assert.equal(instances, 2);
  } finally { globalThis.window=originalWindow; globalThis.document=originalDocument; }
});
