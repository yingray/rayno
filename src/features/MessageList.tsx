import { Children, isValidElement, memo, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import { Button, Icon } from '../components/ui';
import { useDemo } from '../data/store';
import { groupChatActivity, type ToolActivityBlock } from '../data/chatBlocks';
import { partsForMessage } from '../data/messageOptions';
import type { BubbleColor, Message } from '../data/types';
import styles from './chat.module.css';
import { MermaidDiagram } from './MermaidDiagram';
import { AttachmentImage } from './AttachmentImage';
import { CodeBlock } from './CodeBlock';

const remarkPlugins = [remarkGfm, remarkCjkFriendly];

const ToolActivity = memo(function ToolActivity({ block, compactTools }: { block: ToolActivityBlock; compactTools: boolean }) {
  const rowsId = useId();
  const [expanded, setExpanded] = useState(
    !compactTools && window.innerWidth >= 768,
  );
  return (
    <section className={styles.toolGroup} aria-label="Tool activity">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={rowsId}
        onClick={() => setExpanded((value) => !value)}
      >
        <Icon name={expanded ? 'chevronDown' : 'chevronForwardOutline'} size={13} />
        {block.duration ? `Worked for ${block.duration}` : 'Tool activity'}
        <span>
          · {block.tools.length} {block.tools.length === 1 ? 'tool' : 'tools'}
        </span>
      </button>
      <ul className={styles.toolRows} id={rowsId} hidden={!expanded}>
        {block.tools.map((tool, index) => (
          <li key={index}>
            <Icon name="codeSlash" size={14} />
            {block.details?.[index] && (block.details[index]!.input !== undefined || block.details[index]!.result !== undefined) ? <details className={styles.toolDetails}>
              <summary>{tool}</summary>
              <h4>Arguments</h4><pre>{formatToolValue(block.details[index]!.input)}</pre>
              <ToolDiff input={block.details[index]!.input} />
              <h4>{block.details[index]!.isError ? 'Error' : 'Result'}</h4>
              <pre>{block.details[index]!.result === undefined ? 'No result reported yet.' : formatToolValue(block.details[index]!.result)}</pre>
            </details> : <span>{tool}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}, (previous, next) => previous.compactTools === next.compactTools
  && previous.block.id === next.block.id && previous.block.duration === next.block.duration
  && previous.block.details === next.block.details
  && previous.block.tools.length === next.block.tools.length
  && previous.block.tools.every((tool, index) => tool === next.block.tools[index]));

function formatToolValue(value: unknown) {
  return typeof value === 'string' ? value : value === undefined ? 'Not reported.' : JSON.stringify(value, null, 2);
}

function ToolDiff({ input }: { input: unknown }) {
  if (!input || typeof input !== 'object') return null;
  const edit = input as Record<string, unknown>;
  if (typeof edit.old_string !== 'string' || typeof edit.new_string !== 'string') return null;
  return <><h4>Changes</h4><pre aria-label="Tool diff">
    <span className={styles.diffRemoved}>{edit.old_string.split('\n').map(line => `- ${line}`).join('\n')}</span>{'\n'}
    <span className={styles.diffAdded}>{edit.new_string.split('\n').map(line => `+ ${line}`).join('\n')}</span>
  </pre></>;
}

const RenderedMarkdown = memo(function RenderedMarkdown({ content, codeFilename, notify }: {
  content: string; codeFilename: string; notify: (message: string) => void;
}) {
  return (
    <Markdown
      remarkPlugins={remarkPlugins}
      components={{
        a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        table: ({ children }) => (
          <div
            className={styles.tableScroll}
            role="region"
            aria-label="Markdown table"
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

const MessageBlock = memo(function MessageBlock({ sessionId, message, optionsDisabled, onOption, bubble, notify }: {
  sessionId: string;
  message: Message;
  optionsDisabled: boolean;
  onOption: (messageId: string, text: string) => void;
  bubble: BubbleColor;
  notify: (message: string) => void;
}) {
  const parts = partsForMessage(message);
  const codeFilename = message.content.match(/\/\* ([\w./-]+) \*\//)?.[1] || 'Code';
  return (
    <article
      className={message.role === 'user' ? styles.userMessage : styles.agentMessage}
      data-bubble={bubble}
    >
      {message.role === 'user' ? (
        <div className={styles.bubble}>
          {message.content}
          {message.attachments?.map((file) => (
            file.ref ? <AttachmentImage key={file.ref} sessionId={sessionId} file={file} /> : <span className={styles.messageAttachment} key={file.name}>
              <Icon name="documentTextOutline" size={15} />
              {file.name}
            </span>
          ))}
        </div>
      ) : (
        <div className={styles.markdown}>
          {parts.map((part, index) => part.kind === 'options' ? (
            <div className={styles.replyOptions} role="group" aria-label="Reply options" key={index}>
              {part.items.map((item, optionIndex) => (
                <Button
                  key={optionIndex}
                  disabled={optionsDisabled}
                  onClick={() => onOption(message.id, item)}
                  icon="arrowUp"
                >
                  {item}
                </Button>
              ))}
            </div>
          ) : (
            <RenderedMarkdown key={index} content={part.content} codeFilename={codeFilename} notify={notify} />
          ))}
          {message.attachments?.map((file) => (
            file.ref ? <AttachmentImage key={file.ref} sessionId={sessionId} file={file} /> : <span className={styles.messageAttachment} key={file.name}>
              <Icon name="documentTextOutline" size={15} />
              {file.name}
            </span>
          ))}
        </div>
      )}
    </article>
  );
});

export const MessageList = memo(function MessageList({ sessionId = '', messages, disabled, pending, onOption }: {
  sessionId?: string; messages: Message[]; disabled: boolean; pending: boolean;
  onOption: (messageId: string, text: string) => void;
}) {
  const { bubble, compactTools, notify } = useDemo((store) => ({
    bubble: store.state.preferences.bubble, compactTools: store.state.preferences.compactTools,
    notify: store.notify,
  }));
  const blocks = useMemo(() => groupChatActivity(messages), [messages]);
  const unanswered = useMemo(() => {
    const lastUser = messages.findLastIndex((message) => message.role === 'user');
    return new Set(messages.slice(lastUser + 1).map((message) => message.id));
  }, [messages]);
  return blocks.map((block) => block.kind === 'tools'
    ? <ToolActivity key={block.id} block={block} compactTools={compactTools} />
    : <MessageBlock key={block.id} sessionId={sessionId} message={block.message}
        bubble={bubble} notify={notify}
        optionsDisabled={disabled || pending || !unanswered.has(block.message.id)} onOption={onOption} />);
});
