import { memo, useState } from 'react';
import { Button } from '../components/ui';
import { useDemo } from '../data/store';
import { messageError } from './errors';
import { allowsSessionScope, pendingCommunications, pendingPermissions, record } from './normalize';
import type { Json } from './normalize';
import styles from './requests.module.css';
import type { Permission } from './normalize';

export const Requests = memo(function Requests({ sessionId }: { sessionId: string }) {
  const { live, state, unavailable } = useDemo((store) => ({
    live: store.live, state: store.snapshot?.sessionData[sessionId]?.agentState,
    unavailable: store.snapshot?.connection !== 'connected' || store.snapshot?.offline,
  }));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!live || !state) return null;
  const permissions = pendingPermissions(state);
  const forms = pendingCommunications(state);
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
    <div className={styles.requests} aria-label="Agent requests">
      {permissions.map((request) => (
        <section key={request.id} className={styles.card}>
          <strong>{request.tool}</strong>
          <p>The agent needs your permission.</p>
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
              >
                Deny
              </Button>
              <Button
                variant="accent"
                disabled={!!busy || unavailable}
                onClick={() =>
                  void run(request.id, () => live.respondPermission(sessionId, request.id, true))
                }
              >
                {busy === request.id ? 'Wait…' : 'Allow once'}
              </Button>
              {allowsSessionScope(request.tool) && <Button disabled={!!busy || unavailable}
                onClick={() => void run(request.id, () => live.respondPermission(sessionId, request.id, true, true))}>
                Allow for this session
              </Button>}
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
            <p>Rayno cannot show a “{form.rawKind}” request. Dismiss it so that the agent does not wait for an answer.</p>
            <div className={styles.actions}>
              <Button disabled={!!busy || unavailable}
                onClick={() => void run(form.id, () => live.answerQuestions(sessionId, form.id, null, form.rawKind))}>
                {busy === form.id ? 'Wait…' : 'Dismiss'}
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
            {question.multiSelect && (question.options || []).length > 1 && <small className={styles.hint}>Choose as many as apply</small>}
            {(question.options || []).map((option: Json) => (
              <label key={option.label} className={styles.option} data-focus-frame>
                <input
                  type={question.multiSelect ? 'checkbox' : 'radio'}
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
                placeholder="Write an answer"
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
          <Button onClick={() => onSubmit(null)}>Dismiss</Button>
          <Button type="submit" variant="accent" disabled={missing || busy}>
            Send answers
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function ClaudeQuestion({ request, busy, onSubmit, onDismiss }: { request: Permission; busy: boolean; onSubmit: (answers: Json) => void; onDismiss: () => void }) {
  const questions = record(request.arguments).questions;
  if (!Array.isArray(questions) || !questions.length) return <p>This question has no supported form.</p>;
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
