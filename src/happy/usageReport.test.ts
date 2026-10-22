import { describe, expect, it } from 'vitest';
import { parseUsageReport, usageQuery, usageTotals } from './usageReport';

describe('Usage reports', () => {
  it('should query local midnight and hourly groups for today', () => {
    const now=new Date(2026,9,23,12,30), midnight=new Date(2026,9,23);
    expect(usageQuery('today','s1',now)).toEqual({sessionId:'s1',startTime:midnight.getTime()/1000,endTime:now.getTime()/1000,groupBy:'hour'});
    expect(usageQuery('30days',undefined,now).startTime).toBe(Math.floor(now.getTime()/1000)-30*86400);
  });
  it('should keep token and cost model totals independent and sort dates', () => {
    const points=parseUsageReport([{timestamp:2,tokens:{claude:30},cost:{codex:0.12},reportCount:1},
      {timestamp:1,tokens:{claude:20,codex:10},cost:{claude:0.2},reportCount:2}]);
    expect(points.map(point=>point.timestamp)).toEqual([1,2]);
    expect(usageTotals(points)).toMatchObject({totalTokens:60,totalCost:0.32,tokens:{claude:50,codex:10},models:['claude','codex']});
  });
  it('should reject an unreadable response and omit invalid model values', () => {
    expect(()=>parseUsageReport(null)).toThrow('unreadable');
    expect(()=>parseUsageReport([{timestamp:'bad',tokens:{},cost:{}}])).toThrow('timestamp');
    expect(parseUsageReport([{timestamp:1,tokens:{model:10,bad:NaN,negative:-1},cost:{},reportCount:1}])[0].tokens).toEqual({model:10});
  });
});
