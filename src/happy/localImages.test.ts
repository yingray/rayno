import { describe, expect, it } from 'vitest';
import { isLocalImageLink, isLocalImageSource, localImageKey, localImagePath, savedLocalImage } from './localImages';

describe('local image paths', () => {
  it.each([
    ['/real/project/images/a.png', '/real/project/images/a.png'],
    ['./images/a%20b.png', '/real/project/images/a b.png'],
    ['file:///real/project/images/a.png', '/real/project/images/a.png'],
    ['file://localhost/real/project/a.png', '/real/project/a.png'],
    ['~/project/a.png', '/real/project/a.png'],
  ])('should resolve %s inside the workspace', (source, expected) => {
    expect(localImagePath(source, '/real/project', '/real')).toBe(expected);
  });
  it.each(['/real/project-other/a.png', '../a.png', '%2e%2e/a.png', '/etc/passwd', 'file://other/real/project/a.png',
    'file:///real/project/a.png#fragment', 'a%00.png', 'https://example.com/a.png', '//example.com/a.png'])
  ('should reject an outside or invalid source %s', source => {
    expect(() => localImagePath(source, '/real/project', '/real')).toThrow();
  });
  it('should resolve Windows paths without treating a drive letter as a URL scheme', () => {
    expect(localImagePath('C:\\work\\images\\a.png', 'C:\\work')).toBe('C:/work/images/a.png');
    expect(localImagePath('file:///C:/work/a.png', 'C:\\work')).toBe('C:/work/a.png');
    expect(() => localImagePath('D:\\work\\a.png', 'C:\\work')).toThrow('outside');
  });
  it('should distinguish local links from public images and unsupported protocols', () => {
    expect(isLocalImageLink('/real/project/a.PNG')).toBe(true);
    expect(isLocalImageLink('./README.md')).toBe(false);
    for (const source of ['https://example.com/a.png', '//example.com/a.png', 'data:image/png;base64,abc', 'javascript:alert(1)'])
      expect(isLocalImageSource(source)).toBe(false);
  });
  it('should bind an imported image to both the message and the original source', () => {
    const file = { name: 'a.png', ref: 'private-ref', size: 10, type: 'image/png' };
    const metadata = { raynoLocalImages: { [localImageKey('reply', '/a.png')]: file } };
    expect(savedLocalImage(metadata, 'reply', '/a.png')).toEqual(file);
    expect(savedLocalImage(metadata, 'other', '/a.png')).toBeUndefined();
    expect(savedLocalImage(metadata, 'reply', '/b.png')).toBeUndefined();
  });
});
