import { useText } from "../i18n";
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Dialog, Empty, Icon, Segment, Toggle } from '../components/ui';
import { version } from '../../package.json';
import { checkForUpdate, currentBuild, forceUpdate, formatBuildTime } from '../app/appUpdate';
import type { UpdateCheck } from '../app/appUpdate';
import type { IconName } from '../components/ui';
import { useDemo } from '../data/store';
import type { BubbleColor, ChatWidth, FontSize, GlassStyle, RecapMode } from '../data/types';
import { DEFAULT_RECAP_STYLE, RECAP_STYLE_LIMIT } from '../happy/systemPrompt';
import styles from './settings.module.css';
import { UsageReport } from './UsageReport';
import { AdvancedSettings } from './AdvancedSettings';

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
  label,
  footer,
  children,
}: {
  label: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.group}>
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

export function Settings() {
  const t = useText();
  const { preferences, dispatch, reset, mode, machines, server, logout, switchMode } = useDemo((store) => ({
    preferences: store.state.preferences, dispatch: store.dispatch, reset: store.reset, mode: store.mode,
    machines: store.machines, server: store.server, logout: store.logout, switchMode: store.switchMode,
  }));
  const location = useLocation();
  const navigate = useNavigate();
  const recapStyleId = useId();
  const category = location.pathname.split('/')[2] || 'appearance';
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
              <Row icon="personOutline" title={t("Avatar style")}>
                <select
                  aria-label={t("Avatar style")}
                  className={styles.inlineSelect}
                  value={preferences.avatar}
                  onChange={(event) =>
                    dispatch({
                      type: 'preferences',
                      value: { avatar: event.target.value as 'provider' | 'initials' },
                    })
                  }
                >
                  <option value="provider">{t("Agent mark")}</option>
                  <option value="initials">{t("Initials")}</option>
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
