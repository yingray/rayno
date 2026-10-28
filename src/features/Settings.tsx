import { useText } from "../i18n";
import { lazy, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, copyText, Dialog, Empty, Icon, Segment, Toggle } from '../components/ui';
import { messageError } from '../happy/errors';
import { version } from '../../package.json';
import { checkForUpdate, currentBuild, forceUpdate, formatBuildTime } from '../app/appUpdate';
import type { UpdateCheck } from '../app/appUpdate';
import type { IconName } from '../components/ui';
import { useDemo } from '../data/store';
import type { AvatarStyle, BubbleColor, ChatWidth, FontSize, GlassStyle, RecapMode } from '../data/types';
import { DEFAULT_RECAP_STYLE, RECAP_STYLE_LIMIT } from '../happy/systemPrompt';
import styles from './settings.module.css';
import { UsageReport } from './UsageReport';
import { AdvancedSettings } from './AdvancedSettings';
import { markdownBackgroundThemes, markdownElements, markdownTextThemes, type MarkdownBackgroundTheme, type MarkdownTextTheme } from '../data/markdownAppearance';
import { markdownAppearanceDemoId } from '../data/markdownAppearanceDemo';
import { LazyBoundary } from '../components/LazyBoundary';

const MarkdownAppearancePreview = lazy(() => import('./MarkdownAppearancePreview').then(module => ({ default: module.MarkdownAppearancePreview })));

const categories: { key: string; label: string; icon: IconName }[] = [
  { key: 'account', label: 'Account', icon: 'personOutline' },
  { key: 'appearance', label: 'Appearance', icon: 'colorPaletteOutline' },
  { key: 'machines', label: 'Machines', icon: 'desktopOutline' },
  { key: 'voice', label: 'Voice', icon: 'micOutline' },
  { key: 'usage', label: 'Usage', icon: 'speedometerOutline' },
  { key: 'developer', label: 'Developer', icon: 'codeOutline' },
  { key: 'advanced', label: 'Advanced', icon: 'optionsOutline' },
];
const fontSizes: { value: FontSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];
const swatches: { name: BubbleColor; color: string }[] = [
  { name: 'rayno', color: '#ad46ff' },
  { name: 'gray', color: '#71717a' },
  { name: 'blue', color: '#3b82f6' },
  { name: 'green', color: '#22c55e' },
  { name: 'purple', color: '#8b5cf6' },
  { name: 'rose', color: '#f43f5e' },
  { name: 'sand', color: '#b89b66' },
];
function ColorSwatches({ label, caption, options, value, onChange }: {
  label: string;
  caption: string;
  options: readonly { value: string; label: string; shade: number | null; color: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useText();
  const selected = options.find(option => option.value === value) || options[0];
  const name = (option: typeof selected) => `${t(option.label)}${option.shade === null ? '' : ` ${option.shade}`}`;
  return <div className={styles.markdownThemeField}>
    <div className={styles.markdownThemeCaption}><span>{caption}</span><small>{name(selected)}</small></div>
    <div className={styles.markdownSwatches} role="group" aria-label={label}>
      {options.map(option => {
        const color = option.color;
        return <button key={option.value} type="button" className={styles.markdownSwatch}
          aria-label={name(option)} title={name(option)} aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}>
          <span className={styles.markdownSwatchDot} data-empty={color === 'transparent' || undefined}
            style={{ background: color === 'transparent' ? undefined : color }} />
        </button>;
      })}
    </div>
  </div>;
}
function Row({
  icon,
  title,
  subtitle,
  className = '',
  children,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.row} ${className}`}>
      <span className={styles.rowIcon}>
        <Icon name={icon} size={17} />
      </span>
      <span className={styles.rowText}>
        <strong>{title}</strong>
        {subtitle && <small>{subtitle}</small>}
      </span>
      {children}
    </div>
  );
}
function Group({
  id,
  label,
  footer,
  children,
}: {
  id?: string;
  label: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className={styles.group}>
      <h2>{label}</h2>
      <div className={styles.groupCard}>{children}</div>
      {footer && <p>{footer}</p>}
    </div>
  );
}

function updateSubtitle(check: UpdateCheck | null, updating: boolean): string {
  if (updating) return 'Installing the latest version…';
  if (!check) return 'Checking for a new version…';
  if (check.status === 'offline') return 'Cannot check for updates. Check your connection.';
  if (check.status === 'current') return 'This is the latest version';
  return `Version ${check.latest.commit} is ready`;
}

function AboutGroup() {
  const t = useText();
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    let active = true;
    void checkForUpdate().then((result) => active && setCheck(result));
    return () => { active = false; };
  }, []);
  const offline = check?.status === 'offline';
  const update = async () => {
    if (offline) {
      setCheck(null);
      setCheck(await checkForUpdate());
      return;
    }
    setUpdating(true);
    const result = await forceUpdate();
    // The page reloads after a successful update. It stays here only when the connection failed.
    if (result.status === 'offline') {
      setCheck(result);
      setUpdating(false);
    }
  };
  return (
    <Group label={t("About")} footer={t("Update now reloads Rayno. Drafts, sessions, and preferences stay on this device.")}>
      <Row
        icon="informationCircleOutline"
        title={t("Rayno")}
        subtitle={`Built ${formatBuildTime(currentBuild.builtAt)}`}
      >
        <span className={styles.value} aria-label={t("Current version")}>
          {version} · {currentBuild.commit}
        </span>
      </Row>
      <Row icon="refreshOutline" title={t("Updates")} subtitle={updateSubtitle(check, updating)}>
        <Button
          className={styles.updateButton}
          variant={check?.status === 'available' ? "accent" : "default"}
          disabled={!check || updating}
          onClick={() => void update()}
        >
          {offline ? t("Check again") : t("Update now")}
        </Button>
      </Row>
    </Group>
  );
}

function ServerDialog({ server, changeServer, onClose }: {
  server: string;
  changeServer: (server: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useText();
  const [draft, setDraft] = useState(server);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      await changeServer(draft);
      onClose();
    } catch (failure) {
      setError(messageError(failure));
      setBusy(false);
    }
  }
  return (
    <Dialog title={t("Change Happy server")} onClose={() => { if (!busy) onClose(); }}>
      <form className={styles.serverForm} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label>
          {t("Happy server")}
          <input
            autoFocus
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://your-mac.your-tailnet.ts.net:3007"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy}
          />
        </label>
        <p>{t("Rayno signs in to the new server with the same recovery key. A server without this account makes a new, empty one. The sessions of the current server leave this browser.")}</p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <Button disabled={busy} onClick={onClose}>{t("Cancel")}</Button>
          <Button type="submit" variant="accent" disabled={busy || !draft.trim()}>
            {busy ? t("Wait…") : t("Connect")}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}

export function Settings() {
  const t = useText();
  const { preferences, dispatch, reset, mode, machines, server, logout, switchMode, recoveryKey, changeServer, notify } = useDemo((store) => ({
    preferences: store.state.preferences, dispatch: store.dispatch, reset: store.reset, mode: store.mode,
    machines: store.machines, server: store.server, logout: store.logout, switchMode: store.switchMode,
    recoveryKey: store.recoveryKey, changeServer: store.changeServer, notify: store.notify,
  }));
  const [editServer, setEditServer] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const recapStyleId = useId();
  const category = location.pathname.split('/')[2] || 'appearance';
  useEffect(() => {
    if (category === 'appearance' && location.hash === '#markdown')
      document.getElementById('markdown')?.scrollIntoView({ block: 'start' });
  }, [category, location.hash]);
  const current = categories.find((item) => item.key === category);
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <section className={styles.settings} aria-label={t("Settings")}>
      <nav className={styles.settingsNav} aria-label={t("Settings categories")}>
        <h1>{t("Settings")}</h1>
        {categories.map((item) => (
          <button
            key={item.key}
            className={category === item.key ? styles.active : ''}
            aria-current={category === item.key ? "page" : undefined}
            onClick={() => navigate(`/settings/${item.key}`)}
          >
            <Icon name={item.icon} size={17} />
            <span>{t(item.label)}</span>
          </button>
        ))}
        <div className={styles.navFooter}>
          <img src="/icons/rayno.svg" alt="" />
          <span>{t("Rayno")}</span>
        </div>
      </nav>
      <div className={styles.content}>
        <header className={styles.contentHeading}>
          <h1>{t(current?.label || 'Settings')}</h1>
          <p>{t("Make this space feel like yours.")}</p>
        </header>
        <div className={styles.mobileNav}>
          <label>{t("Settings category")}<select
              aria-label={t("Settings category")}
              value={category}
              onChange={(event) => navigate(`/settings/${event.target.value}`)}
            >
              {categories.map((item) => (
                <option value={item.key} key={item.key}>
                  {t(item.label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {category === 'appearance' ? (
          <>
            <Group label={t("Appearance")}>
              <Row icon="colorPaletteOutline" title={t("Theme")}>
                <span className={styles.value}>{t("Dark")}<Icon name="chevronForwardOutline" size={12} />
                </span>
              </Row>
              <Row icon="sparklesOutline" title={t("Glass style")} subtitle={t("Transparency, blur, and highlights")} className={styles.chatWidthRow}>
                <select aria-label={t("Glass style")} className={styles.widthSelect} value={preferences.glassStyle}
                  onChange={event => dispatch({ type: 'preferences', value: { glassStyle: event.target.value as GlassStyle } })}>
                  <option value="standard">{t("Standard")}</option>
                  <option value="intense">{t("Intense")}</option>
                </select>
              </Row>
              <Row
                icon="textOutline"
                title={t("Font size")}
                subtitle={t("Text in chat messages")}
                className={styles.fontSizeRow}
              >
                <Segment
                  label={t("Font size")}
                  className={styles.fontSize}
                  options={fontSizes}
                  value={preferences.fontSize}
                  onChange={(fontSize) => dispatch({ type: 'preferences', value: { fontSize } })}
                />
              </Row>
              <Row icon="expandOutline" title={t("Chat width")} subtitle={t("Messages and the composer")} className={styles.chatWidthRow}>
                <select aria-label={t("Chat width")} className={styles.widthSelect} value={preferences.chatWidth}
                  onChange={event => dispatch({ type: 'preferences', value: { chatWidth: event.target.value as ChatWidth } })}>
                  <option value="full">{t("Full width")}</option>
                  <option value="medium">{t("Moderate width")}</option>
                  <option value="standard">{t("Standard width")}</option>
                </select>
              </Row>
              <Row icon="mailOutline" title={t("User message bubble")}>
                <div
                  className={styles.swatches}
                  role="group"
                  aria-label={t("User message bubble color")}
                >
                  {swatches.map((swatch) => (
                    <button
                      key={swatch.name}
                      aria-label={`Use ${swatch.name} message bubbles`}
                      title={swatch.name}
                      aria-pressed={preferences.bubble === swatch.name}
                      style={{ background: swatch.color }}
                      onClick={() =>
                        dispatch({ type: 'preferences', value: { bubble: swatch.name } })
                      }
                    />
                  ))}
                </div>
              </Row>
              <Row icon="personOutline" title={t("Avatar style")} className={styles.chatWidthRow}
                subtitle={preferences.avatar === 'planets' ? t("A fixed planet for each session") : undefined}>
                <select
                  aria-label={t("Avatar style")}
                  className={styles.widthSelect}
                  value={preferences.avatar}
                  onChange={(event) =>
                    dispatch({
                      type: 'preferences',
                      value: { avatar: event.target.value as AvatarStyle },
                    })
                  }
                >
                  <option value="provider">{t("Agent mark")}</option>
                  <option value="initials">{t("Initials")}</option>
                  <option value="planets">DiceBear Planets</option>
                </select>
              </Row>
              <Row
                icon="terminalOutline"
                title={t("Compact tool calls")}
                subtitle={t("Collapse tool activity by default")}
              >
                <Toggle
                  label={t("Compact tool calls")}
                  checked={preferences.compactTools}
                  onChange={() =>
                    dispatch({
                      type: 'preferences',
                      value: { compactTools: !preferences.compactTools },
                    })
                  }
                />
              </Row>
            </Group>
            <Group id="markdown" label={t('Markdown')} footer={t('Official shadcn/Tailwind colors: color text 300, neutral text 400, backgrounds 950.')}>
              {markdownElements.map(element => <Row key={element.value} icon="colorPaletteOutline" title={t(element.label)} className={styles.markdownThemeRow}>
                <div className={styles.markdownThemePair}>
                  <ColorSwatches label={t(element.textLabel)} caption={t('Text color')} options={markdownTextThemes}
                    value={preferences[element.textKey]}
                    onChange={value => dispatch({ type: 'preferences', value: { [element.textKey]: value as MarkdownTextTheme } })} />
                  <ColorSwatches label={t(element.backgroundLabel)} caption={t('Background')} options={markdownBackgroundThemes}
                    value={preferences[element.backgroundKey]}
                    onChange={value => dispatch({ type: 'preferences', value: { [element.backgroundKey]: value as MarkdownBackgroundTheme } })} />
                </div>
              </Row>)}
              <LazyBoundary><MarkdownAppearancePreview preferences={preferences} /></LazyBoundary>
              {mode === 'demo' && <div className={styles.markdownDemoLink}>
                <Button icon="chatbubblesOutline" onClick={() => navigate(`/session/${markdownAppearanceDemoId}?demo=1`)}>{t('Open Markdown demo')}</Button>
              </div>}
            </Group>
            <Group label={t("Reading")}>
              <Row icon="speedometerOutline" title={t("Faster long chats (preview)")} className={styles.readingRow}
                subtitle={t("Render a smaller part of long chats. Turn this off to show the full transcript.")}>
                <Toggle label={t("Faster long chats (preview)")} checked={preferences.fasterTranscript}
                  onChange={() => dispatch({ type: 'preferences', value: { fasterTranscript: !preferences.fasterTranscript } })} />
              </Row>
            </Group>
            <Group label={t("Composer")}>
              <Row icon="arrowUp" title={t("Enter to send")} subtitle={t("Shift+Enter adds a new line")}>
                <Toggle
                  label={t("Enter to send")}
                  checked={preferences.enterToSend}
                  onChange={() =>
                    dispatch({
                      type: 'preferences',
                      value: { enterToSend: !preferences.enterToSend },
                    })
                  }
                />
              </Row>
              <Row icon="sparklesOutline" title={t("Recap")} subtitle={t("When agents end a long reply with a recap")} className={styles.chatWidthRow}>
                <select aria-label={t("Recap")} className={styles.widthSelect} value={preferences.recap}
                  onChange={event => dispatch({ type: 'preferences', value: { recap: event.target.value as RecapMode } })}>
                  <option value="auto">{t("Auto")}</option>
                  <option value="manual">{t("Manual only")}</option>
                </select>
              </Row>
              <div className={`${styles.row} ${styles.recapStyleRow}`}>
                <span className={styles.rowIcon}>
                  <Icon name="textOutline" size={17} />
                </span>
                <label className={styles.rowText} htmlFor={recapStyleId}>
                  <strong>{t("Recap style")}</strong>
                  <small>{t("Voice, length, and order the agent uses for a recap. Leave it empty to use only the format rules.")}</small>
                </label>
                <textarea id={recapStyleId} className={styles.recapStyle} rows={6} maxLength={RECAP_STYLE_LIMIT}
                  value={preferences.recapStyle}
                  onChange={event => dispatch({ type: 'preferences', value: { recapStyle: event.target.value } })} />
                <Button className={styles.recapStyleReset} icon="refreshOutline"
                  disabled={preferences.recapStyle === DEFAULT_RECAP_STYLE}
                  onClick={() => dispatch({ type: 'preferences', value: { recapStyle: DEFAULT_RECAP_STYLE } })}>{t("Reset to default")}</Button>
              </div>
              <Row icon="micOutline" title={t("Read recaps aloud automatically")} subtitle={t("Starts after you interact with the page")}>
                <Toggle
                  label={t("Read recaps aloud automatically")}
                  checked={preferences.recapAutoplay}
                  onChange={() =>
                    dispatch({
                      type: 'preferences',
                      value: { recapAutoplay: !preferences.recapAutoplay },
                    })
                  }
                />
              </Row>
            </Group>
            <p className={styles.note}>{t("Appearance and drafts stay in Rayno on this device.")}</p>
          </>
        ) : category === 'account' ? (
          <>
            <div className={styles.accountCard}>
              <span>{t("R")}</span>
              <h2>{mode === 'demo' ? t("Ray") : t("Happy account")}</h2>
              <p>{t("Personal workspace")}</p>
              <small>{mode === 'demo' ? t("Local demo account") : server}</small>
            </div>
            <Group label={t("This device")}>
              <Row
                icon="shieldCheckmarkOutline"
                title={mode === 'demo' ? t("Local workspace") : t("Connected to Happy")}
                subtitle={
                  mode === 'demo'
                    ? t("Sessions and preferences stay in this browser")
                    : t("Session changes sync with your other Happy clients")
                }
              >
                <span className={styles.localChip}>{mode === 'demo' ? t("Local") : t("Live")}</span>
              </Row>
            </Group>
            {server && recoveryKey && changeServer && (
              <Group
                label={t("Sign-in")}
                footer={mode === 'demo'
                  ? t("The demo uses a sample server and a sample key. Nothing connects.")
                  : t("Anyone with the recovery key can read all of your sessions. Keep it private.")}
              >
                <Row icon="serverOutline" title={t("Happy server")} subtitle={server}>
                  <Button className={styles.rowAction} onClick={() => setEditServer(true)}>{t("Change")}</Button>
                </Row>
                <Row icon="keyOutline" title={t("Recovery key")} subtitle={t("Sign in on another device or browser")}>
                  <Button
                    className={styles.rowAction}
                    icon="copyOutline"
                    aria-label={t("Copy recovery key")}
                    onClick={() => void copyText(recoveryKey, notify)}
                  >
                    {t("Copy")}
                  </Button>
                </Row>
              </Group>
            )}
            {editServer && server && changeServer && (
              <ServerDialog server={server} changeServer={changeServer} onClose={() => setEditServer(false)} />
            )}
            <p className={styles.note}>
              {mode === 'demo'
                ? t("This demo does not require sign-in.")
                : t("This browser uses its own Rayno authorization. Sign out clears Rayno credentials and cached account data.")}
            </p>
            {mode === 'live' && (
              <Button icon="logOutOutline" onClick={logout}>{t("Sign out of Rayno")}</Button>
            )}
            {mode === 'demo' && (
              <Button variant="accent" onClick={switchMode}>{t("Connect to Happy")}</Button>
            )}
          </>
        ) : category === 'machines' ? (
          <Group label={t("Computers")}>
            {machines.map((machine) => (
              <button
                className={styles.machineRow}
                key={machine.id}
                onClick={() => navigate(`/machine/${machine.id}`)}
              >
                <Icon name="desktopOutline" size={20} />
                <span>
                  {machine.name}
                  <small>{machine.os}</small>
                </span>
                <i style={{ background: machine.online ? 'var(--green)' : '#71717a' }} />
                <Icon name="chevronForwardOutline" size={14} />
              </button>
            ))}
          </Group>
        ) : category === 'voice' ? (
          <Empty icon="micOutline" title={t("A little quieter here")}>{t("Voice is available in the Happy app.")}</Empty>
        ) : category === 'advanced' ? <AdvancedSettings /> : category === 'usage' ? (<>
          <UsageReport />
          <Group label={t("Agent usage")}>
            <Row
              icon="pulseOutline"
              title={t("Monitor your agents")}
              subtitle={
                mode === 'demo'
                  ? t("Explore sample weekly usage and computer health")
                  : t("Read weekly usage and computer health")
              }
            >
              <Button
                icon="arrowForward"
                aria-label={t("Open usage Monitor")}
                onClick={() => navigate('/monitor')}
              />
            </Row>
          </Group>
        </>) : category === 'developer' ? (
          <>
            {mode === 'live' ? (
              <Group label={t("Data source")}>
                <Row icon="codeOutline" title={t("Happy backend")} subtitle={server}>
                  <span className={styles.localChip}>{t("Live")}</span>
                </Row>
                <Row
                  icon="codeSlash"
                  title={t("Demo mode")}
                  subtitle={t("Open a separate workspace with sample data")}
                >
                  <Button onClick={switchMode}>{t("Open demo")}</Button>
                </Row>
              </Group>
            ) : (
              <Group
                label={t("Demo data")}
                footer={t("Reset removes local sessions, messages, drafts, and preferences.")}
              >
                <Row
                  icon="codeOutline"
                  title={t("Data source")}
                  subtitle={t("Deterministic local sample data")}
                >
                  <span className={styles.localChip}>{t("Demo")}</span>
                </Row>
                <Row
                  icon="refreshOutline"
                  title={t("Reset demo")}
                  subtitle={t("Restore the original sample workspace")}
                >
                  <Button variant="danger" onClick={() => setConfirmReset(true)}>{t("Reset")}</Button>
                </Row>
              </Group>
            )}
            <AboutGroup />
          </>
        ) : (
          <Empty title={t("Settings page not found")}>{t("Choose a category from the settings navigation.")}</Empty>
        )}
        <footer className={styles.contentFooter}>
          <span />{t("Saved on this device")}</footer>
      </div>
      {confirmReset && (
        <Dialog title={t("Reset demo data?")} onClose={() => setConfirmReset(false)}>
          <p>{t("This removes your local changes and restores the sample sessions and default preferences.")}</p>
          <footer>
            <Button onClick={() => setConfirmReset(false)}>{t("Cancel")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                reset();
                setConfirmReset(false);
              }}
            >{t("Reset demo")}</Button>
          </footer>
        </Dialog>
      )}
    </section>
  );
}
