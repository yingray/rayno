type Group = {
  phase: string; project: string; kind: string; metric: string; offMedian: number; onMedian: number;
  pairedMedianDelta: number; deltaCI95: number[]; holmP: number;
};
export type PairedReport = {
  method: { sessions: number; pairsPerProjectPerPhase: number; samplesPerInteractionPerPage: number; warmupsPerInteractionPerPage: number; limitations: string[] };
  groups: Group[];
};
const browsers: Record<string, string> = {
  'desktop-chromium': 'Desktop Chromium', 'mobile-chromium': 'Mobile Chromium',
  'desktop-webkit': 'Desktop WebKit', 'mobile-webkit': 'Mobile WebKit',
};
const kinds: Record<string, string> = { live: 'New reply', input: 'Draft character', option: 'Option toggle' };
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
const number = (value: number) => (Math.abs(value) < .005 ? 0 : value).toLocaleString('en-US', { maximumFractionDigits: 2 });
const signed = (value: number) => `${value >= .005 ? '+' : ''}${number(value)}`;
function table(groups: Group[], label: string, profiling: boolean) {
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="${label}"><table>
    <caption>${profiling ? 'Committed render CPU. ' : ''}Page medians across eight adjacent A/B pairs. Delta is on minus off; negative values favor the compiler.</caption>
    <thead><tr><th scope="col">Browser / interaction</th><th scope="col">Compiler off</th><th scope="col">Compiler on</th><th scope="col">Paired delta</th></tr></thead><tbody>
    ${groups.map(group => {
      const underClock = group.offMedian === 0 && group.onMedian === 0;
      return `<tr><th scope="row">${browsers[group.project]}<br>${kinds[group.kind]}</th>
        <td data-label="Compiler off"><strong>${underClock ? 'Below timer precision' : number(group.offMedian) + ' ms'}</strong></td>
        <td data-label="Compiler on"><strong>${underClock ? 'Below timer precision' : number(group.onMedian) + ' ms'}</strong></td>
        <td data-label="Paired delta"><strong>${underClock ? 'Not resolved' : signed(group.pairedMedianDelta) + ' ms'}</strong><span>95% paired CI ${signed(group.deltaCI95[0])} to ${signed(group.deltaCI95[1])} ms</span></td></tr>`;
    }).join('')}</tbody></table></div>`;
}
export function pairedReportSections(report: PairedReport) {
  const cpu = report.groups.filter(group => group.metric === 'renderMs');
  const dom = report.groups.filter(group => group.metric === 'domMs');
  const frames = report.groups.filter(group => group.metric === 'nextFrameMs');
  return `<section id="paired"><h2>Paired same-build A/B comparison</h2>
    <p>${report.method.sessions} isolated pages. Each browser uses ${report.method.pairsPerProjectPerPhase} adjacent pairs per phase, with the first variant reversed in each next pair. Both variants use the same JavaScript payload and 200-turn fixture.</p>
    <p>Each page discards ${report.method.warmupsPerInteractionPerPage} warm-ups, then records ${report.method.samplesPerInteractionPerPage} operations per scenario. The experimental unit is the paired page median, not each repeated action.</p>
    <p><a class="download-link" href="./react-compiler-paired.json" download>Download paired measurements and analysis</a></p>
    <h2>React render CPU for one new reply</h2><p>The profiling build sums React actualDuration for all commits during one interaction. This is render CPU, not DOM commit duration.</p>
    ${table(cpu.filter(group => group.kind === 'live'), 'Paired React render comparison', true)}
    <details><summary>Show input and option render CPU</summary><p>WebKit reports integer-millisecond durations here. A zero does not mean zero work. Small differences can reach the clock's precision limit.</p>
    ${table(cpu.filter(group => group.kind !== 'live'), 'Paired input and option render comparison', true)}</details>
  </section>
  <section><h2>Normal production response times</h2><p>A separate build uses the normal production renderer without a Profiler. Timing starts at native browser input/click capture, or after a reply reaches the browser WebSocket.</p>
    <p>The DOM boundary includes client decryption and state work for replies. It excludes fixture encryption and transport before browser delivery.</p>
    ${table(dom.filter(group => group.kind === 'live'), 'Paired reply DOM comparison', false)}
    <details><summary>Show input and option response times</summary>${table(dom.filter(group => group.kind !== 'live'), 'Paired input and option DOM comparison', false)}</details>
    <details><summary>Show next-frame timings</summary><p>Two animation callbacks after the DOM change bracket a rendering opportunity. These values are not INP or physical display latency.</p>${table(frames, 'Paired next-frame comparison', false)}</details>
  </section>
  <section><h2>Statistical interpretation</h2><p>Intervals use 20,000 seeded bootstrap resamples of complete adjacent pairs. They are descriptive, not simultaneous confidence intervals. A zero-width interval can reflect clock quantization; it does not establish equivalence.</p>
    <p>The JSON also contains exact sign-flip p values and Holm adjustment across 12 comparisons per metric. Rounded sub-millisecond differences alone do not establish a useful improvement.</p>
    <ul>${report.method.limitations.map(value => `<li>${escape(value)}</li>`).join('')}</ul></section>`;
}
