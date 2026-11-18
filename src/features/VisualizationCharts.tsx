import { useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { ScatterChart } from '../happy/visualizations';
import { useText } from '../i18n';
import styles from './visualization.module.css';

const palette = ['#bc9aff', '#68caef', '#76d5a2', '#ffc37a', '#fb98bc'];
const scale = (value: number, log: boolean) => log ? Math.log10(value) : value;
const reversedScale = (value: number, log: boolean) => log ? 10 ** value : value;
const shortNumber = (value: number) => Math.abs(value) > 99999 || (value !== 0 && Math.abs(value) < 0.001)
  ? value.toExponential(1) : Number(value.toPrecision(3)).toString();

function extent(values: number[], domain: [number, number] | null, log: boolean): [number, number] {
  const min = scale(Math.min(...values, ...(domain || [])), log);
  const max = scale(Math.max(...values, ...(domain || [])), log);
  const margin = Math.max((max - min) * .05, max === min ? (log ? .3 : Math.max(1, Math.abs(min) * .05)) : 0);
  return [min - margin, max + margin];
}

function ScatterPlot({ chart }: { chart: ScatterChart }) {
  const t = useText();
  const plot = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(320);
  const [selected, setSelected] = useState(0);
  useLayoutEffect(() => {
    const element = plot.current!;
    const resize = () => setWidth(Math.max(180, Math.round(element.getBoundingClientRect().width)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const groups = [...new Set(chart.points.map(point => point.series))];
  const color = (series: string) => palette[groups.indexOf(series) % palette.length];
  const [xMin, xMax] = extent(chart.points.map(point => point.x), chart.xDomain, chart.xLog);
  const [yMin, yMax] = extent(chart.points.map(point => point.y), chart.yDomain, chart.yLog);
  const left = 53, top = 14, right = width - 28, bottom = 174, height = 204;
  const plotX = (value: number) => left + (right - left) * (scale(value, chart.xLog) - xMin) / (xMax - xMin);
  const plotY = (value: number) => bottom - (bottom - top) * (scale(value, chart.yLog) - yMin) / (yMax - yMin);
  const points = chart.points.map(point => ({ x: plotX(point.x), y: plotY(point.y) }));
  const shown = chart.points[selected], current = points[selected];
  const xTicks = width <= 300 ? [0, .5, 1] : [0, .25, .5, .75, 1];
  const yTicks = [0, .25, .5, .75, 1];
  function choosePoint(event: MouseEvent<SVGSVGElement>) {
    const { left, top, width: screenWidth, height: screenHeight } = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - left) * width / screenWidth;
    const y = (event.clientY - top) * height / screenHeight;
    let closest = Infinity, index = 0;
    for (const [i, point] of points.entries()) {
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (distance < closest) { closest = distance; index = i; }
    }
    setSelected(index);
  }
  return <section className={styles.chart} aria-label={chart.title || t('Scatter chart')}>
    {chart.title && <h3>{chart.title}</h3>}
    {chart.description && <p>{chart.description}</p>}
    <span className={styles.axis}>{chart.yLabel}</span>
    <svg ref={plot} className={styles.plot} viewBox={`0 0 ${width} ${height}`} height={height} onClick={choosePoint} aria-hidden="true">
      {yTicks.map(fraction => {
        const y = bottom - fraction * (bottom - top);
        return <g key={fraction}><line x1={left} x2={right} y1={y} y2={y} />
          <text x={left - 7} y={y + 4} textAnchor="end">{shortNumber(reversedScale(yMin + fraction * (yMax - yMin), chart.yLog))}</text></g>;
      })}
      {xTicks.map(fraction => {
        const x = left + fraction * (right - left);
        return <g key={fraction}><line x1={x} x2={x} y1={top} y2={bottom} />
          <text x={x} y={bottom + 21} textAnchor="middle">{shortNumber(reversedScale(xMin + fraction * (xMax - xMin), chart.xLog))}</text></g>;
      })}
      {points.map((point, i) => <circle key={i} cx={point.x} cy={point.y} r={5} fill={color(chart.points[i].series)} />)}
      <circle cx={current.x} cy={current.y} r={9} fill="none" stroke={color(shown.series)} strokeWidth={2} />
    </svg>
    <span className={styles.axis}>{chart.xLabel}</span>
    {groups.some(Boolean) && <ul className={styles.legend}>
      {groups.filter(Boolean).map(group => <li key={group}><i style={{ background: color(group) }} /><span>{group}</span></li>)}
    </ul>}
    <label className={styles.pointPicker}>{t('Data point')}
      <select value={selected} onChange={event => setSelected(Number(event.currentTarget.value))}>
        {chart.points.map((point, index) => <option key={index} value={index}>{point.name}</option>)}
      </select>
    </label>
    <div role="status" className={styles.values}>
      <span>{chart.xLabel} <strong>{shown.x}</strong></span>
      <span>{chart.yLabel} <strong>{shown.y}</strong></span>
    </div>
  </section>;
}

export default function VisualizationCharts({ charts }: { charts: ScatterChart[] }) {
  return <>{charts.map((chart, index) => <ScatterPlot chart={chart} key={index} />)}</>;
}
