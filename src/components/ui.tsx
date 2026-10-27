import { useText } from "../i18n";
import { lazy, memo, Suspense, useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatSessionTimestamp } from '../data/sessionList';
import { useMinuteNow } from './useMinuteNow';
import {
  add,
  arrowUp,
  arrowDown,
  arrowForward,
  arrowBack,
  archiveOutline,
  searchOutline,
  codeSlash,
  mailOutline,
  pulseOutline,
  settingsOutline,
  chevronBackOutline,
  chevronForwardOutline,
  chevronDown,
  chevronUp,
  gitBranchOutline,
  informationCircleOutline,
  ellipsisHorizontal,
  shieldCheckmarkOutline,
  stop,
  close,
  checkmark,
  desktopOutline,
  folderOutline,
  sparklesOutline,
  attachOutline,
  refreshOutline,
  batteryChargingOutline,
  batteryHalfOutline,
  wifiOutline,
  speedometerOutline,
  warningOutline,
  copyOutline,
  gitCompareOutline,
  stopCircleOutline,
  trashOutline,
  pencilOutline,
  createOutline,
  personOutline,
  colorPaletteOutline,
  micOutline,
  codeOutline,
  documentTextOutline,
  terminalOutline,
  checkmarkCircleOutline,
  cloudOfflineOutline,
  gitNetworkOutline,
  expandOutline,
  logOutOutline,
  notificationsOutline,
  swapHorizontalOutline,
  optionsOutline,
  textOutline,
  remove,
  menuOutline,
  sparkles,
  play,
  pause,
  handLeftOutline,
  chatbubblesOutline,
  locateOutline,
  listOutline,
  checkmarkCircle,
  radioButtonOnOutline,
  ellipseOutline,
} from 'ionicons/icons';
import { useDemo } from '../data/store';
import type { Agent } from '../data/types';
import styles from './ui.module.css';

const icons = {
  sidebarOutline: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512' class='ionicon'><rect x='48' y='80' width='416' height='352' rx='40' stroke-linejoin='round' class='ionicon-fill-none ionicon-stroke-width'/><path d='M176 80v352' class='ionicon-fill-none ionicon-stroke-width'/></svg>",
  add,
  arrowUp,
  arrowDown,
  arrowForward,
  arrowBack,
  archiveOutline,
  searchOutline,
  codeSlash,
  mailOutline,
  pulseOutline,
  settingsOutline,
  chevronBackOutline,
  chevronForwardOutline,
  chevronDown,
  chevronUp,
  gitBranchOutline,
  informationCircleOutline,
  ellipsisHorizontal,
  shieldCheckmarkOutline,
  stop,
  close,
  checkmark,
  desktopOutline,
  folderOutline,
  sparklesOutline,
  attachOutline,
  refreshOutline,
  batteryChargingOutline,
  batteryHalfOutline,
  wifiOutline,
  speedometerOutline,
  warningOutline,
  copyOutline,
  gitCompareOutline,
  stopCircleOutline,
  trashOutline,
  pencilOutline,
  createOutline,
  personOutline,
  colorPaletteOutline,
  micOutline,
  codeOutline,
  documentTextOutline,
  terminalOutline,
  checkmarkCircleOutline,
  cloudOfflineOutline,
  gitNetworkOutline,
  expandOutline,
  logOutOutline,
  notificationsOutline,
  swapHorizontalOutline,
  optionsOutline,
  textOutline,
  remove,
  menuOutline,
  sparkles,
  play,
  pause,
  handLeftOutline,
  chatbubblesOutline,
  locateOutline,
  listOutline,
  checkmarkCircle,
  radioButtonOnOutline,
  ellipseOutline,
};
export type IconName = keyof typeof icons;
export const Icon = memo(function Icon({
  name,
  size = 20,
  className = '',
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const svg = icons[name].slice(icons[name].indexOf(',') + 1);
  return (
    <span
      className={`${styles.icon} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});
export function Button({
  children,
  icon,
  variant = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  variant?: 'default' | 'accent' | 'danger' | 'ghost';
}) {
  return (
    <button
      type="button"
      {...props}
      className={`${styles.button} ${styles[variant]} ${!children ? styles.round : ''} ${className}`}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}
const PlanetAvatar = lazy(() => import('./PlanetAvatar'));

export const Avatar = memo(function Avatar({ agent, size = 38, sessionId }: { agent: Agent; size?: number; sessionId?: string }) {
  const t = useText();
  const avatar = useDemo((store) => store.state.preferences.avatar);
  const planet = avatar === 'planets' && !!sessionId;
  const mark = <img className={agent !== 'Claude' ? styles.whiteIcon : ''}
    src={`/icons/${agent === 'Claude' ? 'claude' : agent === 'Codex' ? 'codex' : 'happy'}.png`} alt="" />;
  return (
    <span className={styles.avatar} style={{ width: size, height: size }} aria-label={agent}
      data-avatar-style={planet ? 'planets' : avatar === 'initials' ? 'initials' : 'provider'}>
      {planet ? <Suspense fallback={mark}><PlanetAvatar sessionId={sessionId!} /></Suspense> : avatar === 'initials' ? (
        <span>{agent === 'Happy Agent' ? t("H") : agent[0]}</span>
      ) : (
        mark
      )}
    </span>
  );
});
export function Mark({ size = 44 }: { size?: number }) {
  return (
    <span className={styles.mark} style={{ width: size, height: size }}>
      <img src="/icons/rayno.svg" alt="Rayno" />
    </span>
  );
}
export function Spinner() {
  const t = useText();
  return <span className={styles.spinner} role="status" aria-label={t("Working")} />;
}
export function Segment<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  return (
    <div
      className={`${styles.segment} ${className}`}
      role="group"
      aria-label={label}
      style={{ '--count': options.length, '--index': index } as CSSProperties}
    >
      <span className={styles.segmentPill} />
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
export function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.toggle}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
    >
      <span />
    </button>
  );
}

export function Dialog({
  children,
  title,
  onClose,
  className = '',
}: PropsWithChildren<{ title: string; onClose: () => void; className?: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const getFocusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
    (getFocusable()[0] || ref.current)?.focus();
    function trap(event: KeyboardEvent) {
      // A dialog opened over another dialog owns Escape and Tab. Its portal comes later in the document.
      const modals = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (modals[modals.length - 1] !== ref.current) return;
      if (
        event.key === 'Escape' &&
        event.target instanceof HTMLElement &&
        event.target.hasAttribute('data-escape-local')
      )
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const elements = getFocusable();
      if (!elements.length) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === ref.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', trap, true);
    return () => {
      document.removeEventListener('keydown', trap, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`${styles.dialog} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
      >
        <header>
          <h2 id={id}>{title}</h2>
          <Button icon="close" aria-label={`Close ${title}`} onClick={onClose} />
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Empty({
  icon = 'codeSlash',
  title,
  children,
  action,
}: PropsWithChildren<{ icon?: IconName; title: string; action?: ReactNode }>) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon name={icon} size={26} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export async function copyText(value: string, notify: (message: string) => void) {
  try {
    await navigator.clipboard.writeText(value);
    notify('Copied to clipboard');
  } catch {
    notify('Could not copy. Check clipboard access in your browser.');
  }
}
export const RelativeTime = memo(function RelativeTime({ time }: { time: number }) {
  const now = useMinuteNow();
  return (
    <time dateTime={new Date(time).toISOString()}>
      {formatSessionTimestamp(time, now)}
    </time>
  );
});
