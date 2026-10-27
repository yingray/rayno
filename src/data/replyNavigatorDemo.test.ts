import { describe, expect, it } from 'vitest';
import { createReplyNavigatorDemo } from './replyNavigatorDemo';
import { responseAnchors } from './responseAnchors';

describe('Reply navigator demo', () => {
  it('should give every reply a tick on the reply rail', () => {
    // Arrange
    const session = createReplyNavigatorDemo(0);
    // Act
    const anchors = responseAnchors(session.messages);
    // Assert
    expect(anchors.map(anchor => anchor.size === 'small' ? anchor.characters : 'tick')).toEqual(Array(5).fill('tick'));
  });
});
