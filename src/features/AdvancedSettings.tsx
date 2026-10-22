import { useText } from "../i18n";
import { useEffect, useState } from 'react';
import { Button, Toggle } from '../components/ui';
import { useDemo } from '../data/store';
import { isConcreteModel } from '../happy/modelOptions';
import styles from './management.module.css';

export function AdvancedSettings() {
  const t = useText();
  const { preferences, dispatch, notify } = useDemo(store => ({ preferences: store.state.preferences, dispatch: store.dispatch, notify: store.notify }));
  const [model, setModel] = useState(preferences.customCodexModel);
  const [error, setError] = useState('');
  useEffect(() => setModel(preferences.customCodexModel), [preferences.customCodexModel]);
  return <section className={styles.card} aria-label={t("Advanced settings")}>
    <h2>{t("Advanced settings")}</h2><div className={styles.fields}>
      <label>{t("Interface language")}<select aria-label={t("Interface language")} value={preferences.language} onChange={event => dispatch({type:'preferences',value:{language:event.target.value as 'en'|'zh-TW'}})}>
        <option value="en">{t("English")}</option><option value="zh-TW">繁體中文</option></select></label>
    </div>
    <label className={styles.setting}>{t("Always show context usage")}<Toggle label={t("Always show context usage")} checked={preferences.alwaysShowContextSize}
      onChange={() => dispatch({type:'preferences',value:{alwaysShowContextSize:!preferences.alwaysShowContextSize}})} /></label>
    <p>{t("Show the context reading below the composer whenever the agent reports a context window.")}</p>
    <form className={styles.form} onSubmit={event => {
      event.preventDefault(); const value = model.trim();
      if (value && (!isConcreteModel(value) || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value))) { setError('Enter a concrete model ID without spaces.'); return; }
      setError(''); dispatch({type:'preferences',value:{customCodexModel:value}}); notify('Custom model saved.');
    }}><label>{t("Custom Codex model ID")}<input aria-label={t("Custom Codex model ID")} value={model} onChange={event => setModel(event.target.value)} maxLength={200} placeholder={t("Exact model ID")} autoCapitalize="none" autoComplete="off" spellCheck={false} /></label>
      <p>{t("The saved ID appears in the Codex model picker. Availability depends on your Codex account. Clear the field to remove it.")}</p>
      {error && <p role="alert">{t(error)}</p>}<Button type="submit">{t("Save model")}</Button>
    </form>
    <p>{t("These preferences belong to Rayno and do not change the Happy app.")}</p>
  </section>;
}
