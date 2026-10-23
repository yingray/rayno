import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Message = { id: number; source: string };
class FakeWorker {
  static all: FakeWorker[] = [];
  posted: Message[] = [];
  terminated = false;
  onmessage?: (event: { data: { id: number; svg?: string; error?: string } }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  constructor() { FakeWorker.all.push(this); }
  postMessage(message: Message) { this.posted.push(message); }
  terminate() { this.terminated = true; }
  reply(svg = '<svg/>') { const last = this.posted.at(-1)!; this.onmessage?.({ data: { id: last.id, svg: svg + last.source } }); }
}
const posted = () => FakeWorker.all.flatMap((worker) => worker.posted.map((message) => message.source));

describe('renderDiagram', () => {
  let renderDiagram: typeof import('./mermaidClient').renderDiagram;
  beforeEach(async () => {
    vi.useFakeTimers();
    FakeWorker.all = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.resetModules();
    ({ renderDiagram } = await import('./mermaidClient'));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('should send one job to the worker at a time, in order', async () => {
    // Act
    const first = renderDiagram('graph A');
    const second = renderDiagram('graph B');
    // Assert
    expect(posted()).toEqual(['graph A']);
    FakeWorker.all[0].reply();
    await expect(first).resolves.toBe('<svg/>graph A');
    expect(posted()).toEqual(['graph A', 'graph B']);
    FakeWorker.all[0].reply();
    await expect(second).resolves.toBe('<svg/>graph B');
  });
  it('should start the timeout when a job runs and end only the running job', async () => {
    // Arrange: the first job takes 9 s, so the second job waits 9 s before it runs.
    const first = renderDiagram('graph A');
    const second = renderDiagram('graph B');
    const third = renderDiagram('graph C');
    await vi.advanceTimersByTimeAsync(9000);
    FakeWorker.all[0].reply();
    await expect(first).resolves.toBe('<svg/>graph A');
    // Act: the second job runs for more than 10 s.
    await vi.advanceTimersByTimeAsync(10001);
    // Assert
    await expect(second).rejects.toThrow('took too long');
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect(FakeWorker.all[1].posted.map((message) => message.source)).toEqual(['graph C']);
    FakeWorker.all[1].reply();
    await expect(third).resolves.toBe('<svg/>graph C');
  });
  it('should remove a waiting job that nobody needs', async () => {
    // Arrange
    const controller = new AbortController();
    renderDiagram('graph A');
    const stale = renderDiagram('graph partial', controller.signal);
    const fresh = renderDiagram('graph final');
    // Act
    controller.abort();
    FakeWorker.all[0].reply();
    // Assert
    await expect(stale).rejects.toThrow('no longer needed');
    expect(posted()).toEqual(['graph A', 'graph final']);
    FakeWorker.all[0].reply();
    await expect(fresh).resolves.toBe('<svg/>graph final');
  });
  it('should keep a shared job while one caller still waits', async () => {
    // Arrange
    const controller = new AbortController();
    renderDiagram('graph A');
    renderDiagram('graph B', controller.signal);
    const other = renderDiagram('graph B');
    // Act
    controller.abort();
    FakeWorker.all[0].reply();
    FakeWorker.all[0].reply();
    // Assert
    await expect(other).resolves.toBe('<svg/>graph B');
  });
  it('should drop the oldest waiting job when 8 jobs wait', async () => {
    // Arrange
    renderDiagram('graph running');
    const waiting = Array.from({ length: 8 }, (_, index) => renderDiagram(`graph ${index}`));
    waiting.forEach((job) => job.catch(() => {}));
    // Act
    renderDiagram('graph new');
    // Assert
    await expect(waiting[0]).rejects.toThrow('busy');
  });
});
