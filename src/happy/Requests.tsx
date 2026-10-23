import { useText } from "../i18n";
import { memo, useCallback, useState } from 'react';
import { Button } from '../components/ui';
import { useDemo, type Store } from '../data/store';
import { messageError } from './errors';
import { allowsSessionScope, pendingCommunications, pendingPermissions, record } from './normalize';
import type { Json } from './normalize';
import styles from './requests.module.css';
import type { Permission } from './normalize';
import type { Message, ToolCall } from '../data/types';

export function questionForTool(state: Json, callId: string) {
  const permission = pendingPermissions(state).find(request => request.tool === 'AskUserQuestion'
    && (request.id === callId || record(state.requests?.[request.id]).toolUseId === callId));
  const form = pendingCommunications(state).find(form => form.kind === 'form'
    && (form.id === callId || record(state.communications?.[form.id]).toolUseId === callId));
  return { permission, form };
}
// The tool call ids that have an open question. The chat mounts an `InlineToolQuestion` only for these calls.
// It matches the same ids as `questionForTool`: the request id, or the `toolUseId` of the request.
export function questionCallIds(state: Json | undefined): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!state) return ids;
  const add = (id: string, toolUseId: unknown) => { ids.add(id); if (typeof toolUseId === 'string') ids.add(toolUseId); };
  for (const request of pendingPermissions(state))
    if (request.tool === 'AskUserQuestion') add(request.id, record(state.requests?.[request.id]).toolUseId);
  for (const form of pendingCommunications(state))
    if (form.kind === 'form') add(form.id, record(state.communications?.[form.id]).toolUseId);
  return ids;
}
const loadedCalls = (messages: Message[]): ToolCall[] => messages.flatMap(message => message.toolCalls || []);

export function InlineToolQuestion({ sessionId, call }: { sessionId: string; call: ToolCall }) {
  const t = useText();
  const select = useCallback((store: Store) => ({ live: store.live,
    state: store.snapshot?.sessionData[sessionId]?.agentState,
    unavailable: store.snapshot?.connection !== 'connected' || !!store.snapshot?.offline }), [sessionId]);
  const { live, state, unavailable } = useDemo(select);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = questionForTool(state || {}, call.id);
  if (!live || (!request.permission && request.form?.kind !== 'form')) return null;
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError(messageError(error)); } finally { setBusy(false); }
  }
  return <section role="group" aria-label={t("Tool question")} className={styles.inline}>
    {request.permission ? <ClaudeQuestion key={request.permission.id} request={request.permission} busy={busy || unavailable}
      onSubmit={answers => void run(() => live!.respondPermission(sessionId, request.permission!.id, true, false, { answers }))}
      onDismiss={() => void run(() => live!.respondPermission(sessionId, request.permission!.id, false))} />
      : request.form?.kind === 'form' && <QuestionForm key={request.form.id} form={{form:{questions:request.form.questions}}} busy={busy || unavailable}
        onSubmit={answers => void run(() => live!.answerQuestions(sessionId, request.form!.id, answers, 'form'))} />}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export const Requests = memo(function Requests({ sessionId }: { sessionId: string }) {
  const t = useText();
  const { live, state, unavailable, messages } = useDemo((store) => ({
    live: store.live, state: store.snapshot?.sessionData[sessionId]?.agentState,
    unavailable: store.snapshot?.connection !== 'connected' || store.snapshot?.offline,
    messages: store.state.sessions.find(session => session.id === sessionId)?.messages || [],
  }));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!live || !state) return null;
  const calls = loadedCalls(messages);
  const inline = calls.map(call => questionForTool(state, call.id));
  const permissions = pendingPermissions(state).filter(request => !inline.some(item => item.permission?.id === request.id));
  const forms = pendingCommunications(state).filter(form => !inline.some(item => item.form?.id === form.id));
  async function run(id: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(id);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(messageError(error));
    } finally {
      setBusy('');
    }
  }
  if (!permissions.length && !forms.length) return null;
  return (
    <div className={styles.requests} aria-label={t("Agent requests")}>
      {permissions.map((request) => (
        <section key={request.id} className={styles.card}>
          <strong>{request.tool}</strong>
          <p>{t("The agent needs your permission.")}</p>
          {request.tool !== 'AskUserQuestion' && <pre>{JSON.stringify(request.arguments, null, 2)}</pre>}
          {request.tool === 'AskUserQuestion' ? (
            <ClaudeQuestion key={request.id} request={request} busy={!!busy || unavailable}
              onSubmit={answers => void run(request.id, () => live.respondPermission(sessionId, request.id, true, false, { answers }))}
              onDismiss={() => void run(request.id, () => live.respondPermission(sessionId, request.id, false))} />
          ) : (
            <div className={styles.actions}>
              <Button
                disabled={!!busy || unavailable}
                onClick={() =>
                  void run(request.id, () => live.respondPermission(sessionId, request.id, false))
                }
              >{t("Deny")}</Button>
              <Button
                variant="accent"
                disabled={!!busy || unavailable}
                onClick={() =>
                  void run(request.id, () => live.respondPermission(sessionId, request.id, true))
                }
              >
                {busy === request.id ? t("Wait…") : t("Allow once")}
              </Button>
              {allowsSessionScope(request.tool) && <Button disabled={!!busy || unavailable}
                onClick={() => void run(request.id, () => live.respondPermission(sessionId, request.id, true, true))}>{t("Allow for this session")}</Button>}
            </div>
          )}
        </section>
      ))}
      {forms.map((form) =>
        form.kind === 'form' ? (
          <QuestionForm
            key={form.id}
            form={{ form: { questions: form.questions } }}
            busy={!!busy || unavailable}
            onSubmit={(answers) => void run(form.id, () => live.answerQuestions(sessionId, form.id, answers, form.kind))}
          />
        ) : (
          <section className={styles.card} key={form.id}>
            <strong>{form.title || 'Unsupported request'}</strong>
            <p>{t("Rayno cannot show a “")}{form.rawKind}{t("” request. Dismiss it so that the agent does not wait for an answer.")}</p>
            <div className={styles.actions}>
              <Button disabled={!!busy || unavailable}
                onClick={() => void run(form.id, () => live.answerQuestions(sessionId, form.id, null, form.rawKind))}>
                {busy === form.id ? t("Wait…") : t("Dismiss")}
              </Button>
            </div>
          </section>
        ),
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
});
export function QuestionForm({
  form,
  busy,
  onSubmit,
}: {
  form: Json;
  busy: boolean;
  onSubmit: (answers: Json | null) => void;
}) {
  const t = useText();
  const [answers, setAnswers] = useState<Record<string, { options: string[]; custom: string }>>({});
  const questions: Json[] = form.form.questions;
  const missing = questions.some(
    (question) =>
      question.required !== false &&
      !answers[question.id]?.options.length &&
      !answers[question.id]?.custom.trim(),
  );
  return (
    <form
      className={styles.card}
      onSubmit={(event) => {
        event.preventDefault();
        if (!missing)
          onSubmit(
            // Happy Web buildAnswers: blank drafts are not sent, and a single choice keeps one option.
            Object.fromEntries(questions.flatMap((question) => {
              const answer = answers[question.id];
              const options = question.multiSelect ? answer?.options || [] : (answer?.options || []).slice(0, 1);
              const custom = answer?.custom.trim() || '';
              return options.length || custom ? [[question.id, { options, ...(custom ? { custom } : {}) }]] : [];
            })),
          );
      }}
    >
      <fieldset disabled={busy}>
        {questions.map((question) => (
          <section key={question.id}>
            <strong>{question.header}</strong>
            <p>{question.question}</p>
            {question.multiSelect && (question.options || []).length > 1 && <small className={styles.hint}>{t("Choose as many as apply")}</small>}
            {(question.options || []).map((option: Json) => (
              <label key={option.label} className={styles.option} data-focus-frame>
                <input
                  type={question.multiSelect ? "checkbox" : "radio"}
                  name={question.id}
                  aria-label={option.label}
                  checked={answers[question.id]?.options.includes(option.label) || false}
                  onChange={(event) =>
                    setAnswers((previous) => ({
                      ...previous,
                      [question.id]: {
                        custom: previous[question.id]?.custom || '',
                        options: question.multiSelect
                          ? event.target.checked
                            ? [...(previous[question.id]?.options || []), option.label]
                            : (previous[question.id]?.options || []).filter(
                                (label) => label !== option.label,
                              )
                          : [option.label],
                      },
                    }))
                  }
                />
                <span>
                  {option.label}
                  {option.description && <small>{option.description}</small>}
                </span>
              </label>
            ))}
            {question.allowCustom !== false && (
              <input
                aria-label={`Answer: ${question.header}`}
                placeholder={t("Write an answer")}
                value={answers[question.id]?.custom || ''}
                onChange={(event) =>
                  setAnswers((previous) => ({
                    ...previous,
                    [question.id]: {
                      options: previous[question.id]?.options || [],
                      custom: event.target.value,
                    },
                  }))
                }
              />
            )}
          </section>
        ))}
        <div className={styles.actions}>
          <Button onClick={() => onSubmit(null)}>{t("Dismiss")}</Button>
          <Button type="submit" variant="accent" disabled={missing || busy}>{t("Send answers")}</Button>
        </div>
      </fieldset>
    </form>
  );
}

function ClaudeQuestion({ request, busy, onSubmit, onDismiss }: { request: Permission; busy: boolean; onSubmit: (answers: Json) => void; onDismiss: () => void }) {
  const t = useText();
  const questions = record(request.arguments).questions;
  if (!Array.isArray(questions) || !questions.length) return <p>{t("This question has no supported form.")}</p>;
  return <QuestionForm form={{ form: { questions: questions.map((question: Json, index: number) => ({
    ...question, id: `question-${index}`, required: true,
  })) } }} busy={busy} onSubmit={answers => {
    if (!answers) { onDismiss(); return; }
    onSubmit(Object.fromEntries(questions.map((question: Json, index: number) => {
      const answer = answers[`question-${index}`];
      return [question.question, [...(answer?.options || []), ...(answer?.custom?.trim() ? [answer.custom.trim()] : [])].join(', ')];
    })));
  }} />;
}
