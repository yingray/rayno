// Published Artificial Analysis scores and average costs by benchmark and effort.
// https://artificialanalysis.ai/providers/openai
// https://artificialanalysis.ai/agents/coding-agents/comparisons/claude-code-vs-codex
const charts = [
  {
    title: 'Intelligence Index v5.0.1',
    spec: { xScale: 'log', xDomain: [0.06, 1.8], yDomain: [25, 60] },
    models: [
      ['6.2 Sol', [['Low', .18, 41], ['Medium', .41, 53], ['High', .56, 55], ['Xhigh', .65, 56], ['Max', 1.01, 57]]],
      ['6.1 Sol', [['Low', .16, 35], ['Medium', .36, 46], ['High', .59, 50], ['Xhigh', .76, 52], ['Max', 1.27, 55]]],
      ['6.1 Terra', [['API none', .23, 31], ['Low', .0713, 29], ['Medium', .17, 38], ['High', .26, 42], ['Xhigh', .40, 45], ['Max', .96, 51]]],
    ],
  },
  {
    title: 'Coding Agent Index v2.1',
    spec: { xDomain: [.20, 1.70], yDomain: [33, 55] },
    models: [
      ['6.2 Sol', [['Low', .33, 37], ['Medium', .57, 45], ['High', .76, 47], ['Xhigh', .90, 50], ['Max', 1.22, 49]]],
      ['6.1 Sol', [['Max', 1.51, 52]]],
      ['6.1 Terra', [['Max', 1.53, 49]]],
    ],
  },
] as const;

export function loadDemoVisualization(): string {
  return charts.map(({ title, spec, models }) => '<script type="application/json" data-viz-chart>' + JSON.stringify({
    title,
    spec: { ...spec, type: 'scatter', x: 'cost', y: 'score', series: 'model', xLabel: 'USD per task', yLabel: 'Score' },
    columns: ['name', 'model', 'cost', 'score'],
    rows: models.flatMap(([model, points]) => points.map(([effort, cost, score]) => [`${model} · ${effort}`, model, cost, score])),
  }) + '</script>').join('\n');
}
