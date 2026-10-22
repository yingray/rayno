// Happy Web sync/apiUsage.ts: timestamps use Unix seconds, and model values stay separate.
export type UsagePeriod = 'today' | '7days' | '30days';
export type UsagePoint = { timestamp: number; tokens: Record<string, number>; cost: Record<string, number>; reportCount: number };
export function usageQuery(period: UsagePeriod, sessionId?: string, date = new Date()) {
  const endTime = Math.floor(date.getTime() / 1000);
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return { ...(sessionId ? { sessionId } : {}), startTime: period === 'today' ? Math.floor(start.getTime() / 1000)
    : endTime - (period === '7days' ? 7 : 30) * 86400, endTime, groupBy: period === 'today' ? 'hour' : 'day' };
}
function values(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The usage report contains an invalid model reading.');
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0));
}
export function parseUsageReport(raw: unknown): UsagePoint[] {
  if (!Array.isArray(raw)) throw new Error('Happy returned an unreadable usage report.');
  return raw.map(point => {
    if (!point || !Number.isFinite(point.timestamp) || point.timestamp < 0) throw new Error('The usage report contains an invalid timestamp.');
    return { timestamp: point.timestamp, tokens: values(point.tokens), cost: values(point.cost),
      reportCount: Number.isFinite(point.reportCount) && point.reportCount >= 0 ? point.reportCount : 0 };
  }).sort((a, b) => a.timestamp - b.timestamp);
}
export function usageTotals(points: UsagePoint[]) {
  const tokens: Record<string, number> = {}, cost: Record<string, number> = {};
  for (const point of points) {
    for (const [model, value] of Object.entries(point.tokens)) tokens[model] = (tokens[model] || 0) + value;
    for (const [model, value] of Object.entries(point.cost)) cost[model] = (cost[model] || 0) + value;
  }
  const models = [...new Set([...Object.keys(tokens), ...Object.keys(cost)])].sort();
  return { tokens, cost, models, totalTokens: Object.values(tokens).reduce((a, b) => a + b, 0), totalCost: Object.values(cost).reduce((a, b) => a + b, 0) };
}
