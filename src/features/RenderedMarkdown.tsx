import { Children, isValidElement, memo } from 'react';
import type { ReactNode } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import { useText } from '../i18n';
import { remarkPlugins } from '../data/recapQuote';
import { isLocalImageLink, isLocalImageSource } from '../happy/localImages';
import { MermaidDiagram } from './MermaidDiagram';
import { LocalImage } from './LocalImage';
import { CodeBlock } from './CodeBlock';
import styles from './chat.module.css';

export const RenderedMarkdown = memo(function RenderedMarkdown({ content, codeFilename, notify, sessionId, messageId }: {
  content: string; codeFilename: string; notify: (message: string) => void;
  sessionId: string; messageId: string;
}) {
  const t = useText();
  return (
    <Markdown
      remarkPlugins={remarkPlugins}
      urlTransform={(url, key) => (key === 'src' && isLocalImageSource(url)) || (key === 'href' && isLocalImageLink(url))
        ? url : defaultUrlTransform(url)}
      components={{
        a: ({ node: _node, ...props }) => props.href && isLocalImageLink(props.href)
          ? <LocalImage sessionId={sessionId} messageId={messageId} source={props.href} alt={typeof props.children === 'string' ? props.children : undefined} />
          : <a {...props} target="_blank" rel="noreferrer noopener" />,
        img: ({ node: _node, ...props }) => typeof props.src === 'string' && isLocalImageSource(props.src)
          ? <LocalImage sessionId={sessionId} messageId={messageId} source={props.src} alt={props.alt} />
          : props.src ? <img {...props} loading="lazy" /> : <span>{t('Image unavailable')}</span>,
        table: ({ children }) => (
          <div
            className={styles.tableScroll}
            data-markdown-table
            role="region"
            aria-label={t("Markdown table")}
            tabIndex={0}
          >
            <table>{children}</table>
          </div>
        ),
        th: ({ children, style }) => <th scope="col" style={style}>{children}</th>,
        pre: ({ children }) => {
          const code = Children.toArray(children)[0];
          if (isValidElement<{ className?: string; children?: ReactNode }>(code)
            && /\blanguage-mermaid\b/i.test(code.props.className || '')) {
            return <MermaidDiagram source={String(code.props.children || '').replace(/\n$/, '')} notify={notify} />;
          }
          if (!isValidElement<{ className?: string; children?: ReactNode }>(code)) return <pre>{children}</pre>;
          const language = /\blanguage-([\w+-]+)/i.exec(code.props.className || '')?.[1].toLowerCase() || '';
          return <CodeBlock source={String(code.props.children || '')} language={language} filename={codeFilename} notify={notify} />;
        },
      }}
    >
      {content}
    </Markdown>
  );
});
