import type { Plugin } from 'vite';
import pairedMeasurements from './results/2026-10-26-react-compiler-paired.json' with { type: 'json' };
import { pairedReportSections } from './compiler/report.ts';
import measurements from './results/2026-10-26-react-compiler.json' with { type: 'json' };

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);
const projects = ['desktop-chromium', 'mobile-chromium', 'desktop-webkit', 'mobile-webkit'];
const names = ['Desktop Chromium', 'Mobile Chromium', 'Desktop WebKit', 'Mobile WebKit'];
type Variant = keyof typeof measurements.variants;
const samples = (variant: Variant, project: string) => measurements.variants[variant]
  .filter(sample => sample.project === project).map(sample => sample.live.shownAfter).sort((a, b) => a - b);
function summary(values: number[]) {
  if (!values.length) return 'Not measured';
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return `<strong>${median.toLocaleString('en-US')} ms</strong><span>${Math.min(...values).toLocaleString('en-US')}–${Math.max(...values).toLocaleString('en-US')} ms range</span>`;
}
function reportHtml() {
  const compiled = measurements.sourceAudit.filter(event => event.kind === 'CompileSuccess').length;
  const skipped = new Set(measurements.sourceAudit.filter(event => event.kind === 'CompileError').map(event => `${event.file}:${event.line}`)).size;
  const rows = projects.map((project, index) => `<tr><th scope="row">${names[index]}</th>${(['before', 'after', 'control'] as const)
    .map((variant, column) => `<td data-label="${['Compiler off', 'Compiler on', 'Later off control'][column]}">${summary(samples(variant, project))}</td>`).join('')}</tr>`).join('');
  const raw = projects.map((project, index) => `<tr><th scope="row">${names[index]}</th>${(['before', 'after', 'control'] as const)
    .map((variant, column) => `<td data-label="${['Compiler off', 'Compiler on', 'Later off control'][column]}">${samples(variant, project).join(', ') || 'Not measured'}</td>`).join('')}</tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#09090b"><title>React Compiler performance report · Rayno</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#09090b;color:#f4f4f5;line-height:1.65}
*{box-sizing:border-box}body{margin:0}main{max-width:1060px;margin:auto;padding:max(24px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(32px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
header{margin-bottom:24px}.eyebrow{color:#c4b5fd;font-size:14px;letter-spacing:.04em}h1{font-size:clamp(28px,5vw,42px);line-height:1.2;margin:10px 0 16px}h2{font-size:22px;margin:0 0 12px}p{margin:0 0 14px}.muted,caption{color:#b5b5c0}.verdict{padding:20px;border:1px solid #65508c;border-radius:18px;background:#1b1526;margin:24px 0}.verdict strong{display:block;font-size:22px;line-height:1.4;margin-bottom:8px}section{margin-top:30px}
nav{display:flex;flex-wrap:wrap;gap:12px}a{color:#ddd6fe;overflow-wrap:anywhere}nav a,.download-link{display:inline-flex;align-items:center;min-height:44px;padding:8px 14px;border:1px solid #4a405b;border-radius:12px;text-decoration:none}a:focus-visible,summary:focus-visible,.table-wrap:focus-visible{outline:1px solid #c4b5fd;outline-offset:2px}a:hover{background:#272033}.table-wrap{overflow-x:auto;overscroll-behavior-x:contain;border:1px solid #34313b;border-radius:14px;-webkit-overflow-scrolling:touch}
table{width:100%;min-width:620px;border-collapse:collapse;text-align:left;font-size:15px}caption{text-align:left;padding:14px}th,td{padding:14px 16px;border-top:1px solid #34313b;vertical-align:top}thead th{background:#19161f}td span{display:block;font-size:13px;color:#b5b5c0;white-space:nowrap}td strong{white-space:nowrap}ul{padding-left:22px}li{margin:8px 0}code{overflow-wrap:anywhere;color:#ddd6fe}details{margin-top:20px;border:1px solid #34313b;border-radius:14px;padding:0 14px 14px}summary{cursor:pointer;min-height:48px;align-content:center;font-weight:600;padding:10px 0}footer{margin-top:32px;color:#b5b5c0;font-size:14px}
@media(max-width:660px){table{display:block;min-width:0}caption,tbody,tr{display:block;width:100%}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}tbody th{display:block;background:#19161f;padding:12px 14px}td{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 10px;padding:12px 14px}td::before{content:attr(data-label);grid-column:1;grid-row:1/3;color:#b5b5c0}td strong{grid-column:2;grid-row:1;white-space:normal}td span{grid-column:2;grid-row:2;white-space:normal}tr+tr{margin-top:14px}}
@media(max-width:480px){main{padding-top:max(20px,env(safe-area-inset-top))}.verdict{padding:16px}nav{flex-direction:column}nav a{justify-content:center}}
</style></head><body><main>
<header><div class="eyebrow">RAYNO · ENGINEERING REPORT</div><h1>React Compiler performance report</h1>
<p class="muted">${escape(measurements.date)} · Base ${escape(measurements.baseCommit)} · Compiler ${escape(measurements.compilerVersion)} · React ${escape(measurements.target)}</p>
<nav aria-label="Report links"><a href="/session/reply-options-demo?demo=1">Try the compiled demo</a><a href="./react-compiler-data.json" download>Download raw measurements</a></nav></header>
<div class="verdict"><strong>No consistent speedup established</strong><p>The paired same-build tests show no material benefit for the tested reply, typing, and option interactions. React render CPU for a new reply stays around 3–4 milliseconds.</p><p>Production response times also remain close. The estimates do not justify a speedup claim, and small WebKit values reach its timer precision limit.</p></div>
${pairedReportSections(pairedMeasurements)}
<details><summary>Show earlier exploratory trial</summary>
<section><h2>Earlier sequential batch timing</h2><p>Each run loads 200 turns and 1,000 tool calls, then delivers 20 live replies. Lower times are better. On phones, each browser has its own comparison block.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Live reply timing comparison"><table><caption>Median and range for the complete live-reply batch; three runs per initial variant, two later desktop control runs.</caption>
<thead><tr><th scope="col">Browser</th><th scope="col">Compiler off</th><th scope="col">Compiler on</th><th scope="col">Later off control</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section><h2>What these numbers measure</h2><ul>${measurements.limitations.map(value => `<li>${escape(value)}</li>`).join('')}</ul>
<p>The later control is a repeat of the same code with <code>RAYNO_REACT_COMPILER=0</code>. It helps show the timing variation over the session.</p></section>
<section><h2>Build cost and coverage</h2><ul><li>One local build sample: 2.17 seconds without the compiler, 4.15 seconds with it.</li>
<li>Uncompressed precache assets: about 2,753.9 KiB before, 2,807.5 KiB after. These totals are not transfer sizes.</li>
<li>The source audit reports ${compiled} successfully compiled functions. The compiler leaves ${skipped} distinct functions unchanged.</li>
<li>Existing manual memoization stays in place. The virtualizer and other unsupported functions keep their original execution path.</li></ul></section>
<section><h2>Validation</h2><p>577 unit tests, 320 production browser cases, two development browser cases, and all 28 timing cases pass. The production selection has 72 device-specific skips.</p>
<p>Browser coverage includes Chromium and WebKit, 320, 360, 390, and 430px phone widths, a short keyboard viewport, and landscape interactions.</p></section>
<details><summary>Show raw reply timings</summary><p>Individual run times in milliseconds, sorted from lowest to highest.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Raw reply timings"><table><thead><tr><th scope="col">Browser</th><th scope="col">Compiler off</th><th scope="col">Compiler on</th><th scope="col">Later off control</th></tr></thead><tbody>${raw}</tbody></table></div></details>
</details>
<footer>This report uses local benchmark fixtures. It contains no account messages. The downloadable JSON is the source for the timing tables.</footer>
</main></body></html>`;
}

// Emit the report and its source data together so a phone can read them without account access.
export function reactCompilerReport(): Plugin {
  return { name: 'rayno-react-compiler-report', apply: 'build', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'reports/react-compiler.html', source: reportHtml() });
    this.emitFile({ type: 'asset', fileName: 'reports/react-compiler-paired.json', source: JSON.stringify(pairedMeasurements, null, 2) + '\n' });
    this.emitFile({ type: 'asset', fileName: 'reports/react-compiler-data.json', source: JSON.stringify(measurements, null, 2) + '\n' });
  } };
}
