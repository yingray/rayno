import type { CSSProperties } from 'react';
import { useText } from '../i18n';
import { useDemo } from '../data/store';
import type { Preferences } from '../data/types';
import { markdownThemeStyle } from '../data/markdownAppearance';
import { markdownAppearancePreview } from '../data/markdownAppearanceDemo';
import { RenderedMarkdown } from './RenderedMarkdown';
import chatStyles from './chat.module.css';
import styles from './settings.module.css';

export function MarkdownAppearancePreview({ preferences }: { preferences: Preferences }) {
  const t = useText();
  const notify = useDemo(store => store.notify);
  const style = {
    ...markdownThemeStyle(preferences),
    '--font-scale': preferences.fontSize === 'small' ? 0.9 : preferences.fontSize === 'large' ? 1.15 : 1,
  } as CSSProperties;
  return <section className={styles.markdownPreview} aria-label={t('Markdown preview')} style={style}>
    <p className={styles.markdownPreviewLabel}>{t('Markdown preview')}</p>
    <div className={chatStyles.markdown} data-markdown-preview>
      <RenderedMarkdown content={markdownAppearancePreview} sessionId="" messageId="markdown-preview" codeFilename="Code" notify={notify} />
    </div>
  </section>;
}
