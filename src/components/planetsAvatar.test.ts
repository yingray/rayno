import { expect, it } from 'vitest';
import { planetsAvatar } from './planetsAvatar';

it('should generate the same local SVG for the same session across calls', () => {
  const original = planetsAvatar('session-one');
  expect(original).toMatch(/^data:image\/svg\+xml/);
  planetsAvatar('another-session');
  expect(planetsAvatar('session-one')).toBe(original);
});

it('should derive a different planet from a different session ID', () => {
  expect(planetsAvatar('session-one')).not.toBe(planetsAvatar('session-two'));
});
