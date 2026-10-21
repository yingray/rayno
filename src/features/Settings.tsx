import { useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Dialog, Empty, Icon, Segment, Toggle } from '../components/ui';
import { version } from '../../package.json';
import type { IconName } from '../components/ui';
import { useDemo } from '../data/store';
import type { BubbleColor, FontSize } from '../data/types';
import styles from './settings.module.css';

const categories: { key: string; label: string; icon: IconName }[] = [
  { key: 'account', label: 'Account', icon: 'personOutline' },
  { key: 'appearance', label: 'Appearance', icon: 'colorPaletteOutline' },
  { key: 'machines', label: 'Machines', icon: 'desktopOutline' },
  { key: 'voice', label: 'Voice', icon: 'micOutline' },
  { key: 'usage', label: 'Usage', icon: 'speedometerOutline' },
  { key: 'developer', label: 'Developer', icon: 'codeOutline' },
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

export function Settings() {
  const { preferences, dispatch, reset, mode, machines, server, logout, switchMode } = useDemo((store) => ({
    preferences: store.state.preferences, dispatch: store.dispatch, reset: store.reset, mode: store.mode,
    machines: store.machines, server: store.server, logout: store.logout, switchMode: store.switchMode,
  }));
  const location = useLocation();
  const navigate = useNavigate();
  const category = location.pathname.split('/')[2] || 'appearance';
  const current = categories.find((item) => item.key === category);
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <section className={styles.settings} aria-label="Settings">
      <nav className={styles.settingsNav} aria-label="Settings categories">
        <h1>Settings</h1>
        {categories.map((item) => (
          <button
            key={item.key}
            className={category === item.key ? styles.active : ''}
            aria-current={category === item.key ? 'page' : undefined}
            onClick={() => navigate(`/settings/${item.key}`)}
          >
            <Icon name={item.icon} size={17} />
            <span>{item.label}</span>
          </button>
        ))}
        <div className={styles.navFooter}>
          <img src="/icons/rayno.svg" alt="" />
          <span>Rayno</span>
        </div>
      </nav>
      <div className={styles.content}>
        <header className={styles.contentHeading}>
          <h1>{current?.label || 'Settings'}</h1>
          <p>Make this space feel like yours.</p>
        </header>
        <div className={styles.mobileNav}>
          <label>
            Settings category
            <select
              aria-label="Settings category"
              value={category}
              onChange={(event) => navigate(`/settings/${event.target.value}`)}
            >
              {categories.map((item) => (
                <option value={item.key} key={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {category === 'appearance' ? (
          <>
            <Group label="Appearance">
              <Row icon="colorPaletteOutline" title="Theme">
                <span className={styles.value}>
                  Dark
                  <Icon name="chevronForwardOutline" size={12} />
                </span>
              </Row>
              <Row
                icon="textOutline"
                title="Font size"
                subtitle="Text in chat messages"
                className={styles.fontSizeRow}
              >
                <Segment
                  label="Font size"
                  className={styles.fontSize}
                  options={fontSizes}
                  value={preferences.fontSize}
                  onChange={(fontSize) => dispatch({ type: 'preferences', value: { fontSize } })}
                />
              </Row>
              <Row icon="mailOutline" title="User message bubble">
                <div
                  className={styles.swatches}
                  role="group"
                  aria-label="User message bubble color"
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
              <Row icon="personOutline" title="Avatar style">
                <select
                  aria-label="Avatar style"
                  className={styles.inlineSelect}
                  value={preferences.avatar}
                  onChange={(event) =>
                    dispatch({
                      type: 'preferences',
                      value: { avatar: event.target.value as 'provider' | 'initials' },
                    })
                  }
                >
                  <option value="provider">Agent mark</option>
                  <option value="initials">Initials</option>
                </select>
              </Row>
              <Row
                icon="terminalOutline"
                title="Compact tool calls"
                subtitle="Collapse tool activity by default"
              >
                <Toggle
                  label="Compact tool calls"
                  checked={preferences.compactTools}
                  onChange={() =>
                    dispatch({
                      type: 'preferences',
                      value: { compactTools: !preferences.compactTools },
                    })
                  }
                />
              </Row>
              <Row
                icon="speedometerOutline"
                title="Show usage"
                subtitle="Usage and context below the composer"
              >
                <Toggle
                  label="Show usage"
                  checked={preferences.showUsage}
                  onChange={() =>
                    dispatch({ type: 'preferences', value: { showUsage: !preferences.showUsage } })
                  }
                />
              </Row>
            </Group>
            <Group label="Composer">
              <Row icon="arrowUp" title="Enter to send" subtitle="Shift+Enter adds a new line">
                <Toggle
                  label="Enter to send"
                  checked={preferences.enterToSend}
                  onChange={() =>
                    dispatch({
                      type: 'preferences',
                      value: { enterToSend: !preferences.enterToSend },
                    })
                  }
                />
              </Row>
            </Group>
            <p className={styles.note}>
              Appearance and drafts stay in Rayno on this device.
            </p>
          </>
        ) : category === 'account' ? (
          <>
            <div className={styles.accountCard}>
              <span>R</span>
              <h2>{mode === 'demo' ? 'Ray' : 'Happy account'}</h2>
              <p>Personal workspace</p>
              <small>{mode === 'demo' ? 'Local demo account' : server}</small>
            </div>
            <Group label="This device">
              <Row
                icon="shieldCheckmarkOutline"
                title={mode === 'demo' ? 'Local workspace' : 'Connected to Happy'}
                subtitle={
                  mode === 'demo'
                    ? 'Sessions and preferences stay in this browser'
                    : 'Session changes sync with your other Happy clients'
                }
              >
                <span className={styles.localChip}>{mode === 'demo' ? 'Local' : 'Live'}</span>
              </Row>
            </Group>
            <p className={styles.note}>
              {mode === 'demo'
                ? 'This demo does not require sign-in.'
                : 'This browser uses its own Rayno authorization. Sign out clears Rayno credentials and cached account data.'}
            </p>
            {mode === 'live' && (
              <Button icon="logOutOutline" onClick={logout}>
                Sign out of Rayno
              </Button>
            )}
            {mode === 'demo' && (
              <Button variant="accent" onClick={switchMode}>
                Connect to Happy
              </Button>
            )}
          </>
        ) : category === 'machines' ? (
          <Group label="Computers">
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
          <Empty icon="micOutline" title="A little quieter here">
            Voice is available in the Happy app.
          </Empty>
        ) : category === 'usage' ? (
          <Group label="Agent usage">
            <Row
              icon="pulseOutline"
              title="Monitor your agents"
              subtitle={
                mode === 'demo'
                  ? 'Explore sample weekly usage and computer health'
                  : 'Read weekly usage and computer health'
              }
            >
              <Button
                icon="arrowForward"
                aria-label="Open usage Monitor"
                onClick={() => navigate('/monitor')}
              />
            </Row>
          </Group>
        ) : category === 'developer' ? (
          <>
            {mode === 'live' ? (
              <Group label="Data source">
                <Row icon="codeOutline" title="Happy backend" subtitle={server}>
                  <span className={styles.localChip}>Live</span>
                </Row>
                <Row
                  icon="codeSlash"
                  title="Demo mode"
                  subtitle="Open a separate workspace with sample data"
                >
                  <Button onClick={switchMode}>Open demo</Button>
                </Row>
              </Group>
            ) : (
              <Group
                label="Demo data"
                footer="Reset removes local sessions, messages, drafts, and preferences."
              >
                <Row
                  icon="codeOutline"
                  title="Data source"
                  subtitle="Deterministic local sample data"
                >
                  <span className={styles.localChip}>Demo</span>
                </Row>
                <Row
                  icon="refreshOutline"
                  title="Reset demo"
                  subtitle="Restore the original sample workspace"
                >
                  <Button variant="danger" onClick={() => setConfirmReset(true)}>
                    Reset
                  </Button>
                </Row>
              </Group>
            )}
            <Group label="About">
              <Row
                icon="informationCircleOutline"
                title="Rayno"
                subtitle="React · TypeScript · local PWA"
              >
                <span className={styles.value}>{version}</span>
              </Row>
            </Group>
          </>
        ) : (
          <Empty title="Settings page not found">
            Choose a category from the settings navigation.
          </Empty>
        )}
        <footer className={styles.contentFooter}>
          <span />
          Saved on this device
        </footer>
      </div>
      {confirmReset && (
        <Dialog title="Reset demo data?" onClose={() => setConfirmReset(false)}>
          <p>
            This removes your local changes and restores the sample sessions and default
            preferences.
          </p>
          <footer>
            <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                reset();
                setConfirmReset(false);
              }}
            >
              Reset demo
            </Button>
          </footer>
        </Dialog>
      )}
    </section>
  );
}
