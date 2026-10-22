import { useText } from "../i18n";
import { memo } from 'react';
import type { ContextUsage } from '../data/types';
import styles from './chat.module.css';

// Adapted from Happy (MIT) components/AgentInput.tsx formatTokenCount and getContextStatus.
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${Math.max(0, Math.round(tokens))}`;
  if (tokens < 999500) return `${Math.round(tokens / 1000)}k`;
  const millions = tokens / 1000000;
  return `${millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10}M`;
}

/** Nothing shows until the session reports its window: a guessed denominator would later jump. */
export function contextStatus(context?: ContextUsage) {
  if (!context?.window || !Number.isFinite(context.window)) return null;
  const used = Math.max(0, Math.min(100, (context.size / context.window) * 100));
  return {
    percent: Math.round(used),
    used: formatTokens(context.size),
    total: formatTokens(context.window),
    tone: 100 - used <= 5 ? 'critical' : 100 - used <= 10 ? 'warning' : undefined,
  };
}

function Ring({ percent }: { percent: number }) {
  const radius = 5.75, circumference = 2 * Math.PI * radius;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={radius} />
      <circle cx="7" cy="7" r={radius} strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - percent / 100)} />
    </svg>
  );
}

// Happy shows context under the input only near the limit unless alwaysShowContextSize is on.
// Rayno has no usage footer, so the composer gets only that warning.
export const ContextWarning = memo(function ContextWarning({ context, always = false }: { context?: ContextUsage; always?: boolean }) {
  const t = useText();
  const status = contextStatus(context);
  if (!status || (!always && !status.tone)) return null;
  return (
    <div className={styles.contextWarning} role="meter" aria-label={t("Context window")} data-tone={status.tone}
      aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100}
      aria-valuetext={`${status.percent}% used, ${status.used} of ${status.total} tokens`}>
      <span>{status.percent}{t("% context")}</span>
      <span className={styles.contextTokens}>{status.used} / {status.total}</span>
      <Ring percent={status.percent} />
    </div>
  );
});

// The full reading, in the Model & effort sheet.
export const ContextMeter = memo(function ContextMeter({ context }: { context?: ContextUsage }) {
  const t = useText();
  const status = contextStatus(context);
  if (!status) return null;
  return (<>
    <h3>{t("Context")}</h3>
    <div className={styles.context} role="meter" aria-label={t("Context window")} data-tone={status.tone}
      aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100}
      aria-valuetext={`${status.percent}% used, ${status.used} of ${status.total} tokens`}>
      <Ring percent={status.percent} />
      <span>{status.percent}{t("% used")}</span>
      <span className={styles.contextTokens}>{status.used} / {status.total}{' '}{t("tokens")}</span>
    </div>
  </>);
});
