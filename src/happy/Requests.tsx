import { memo, useState } from 'react';
import { Button } from '../components/ui';
import { useDemo } from '../data/store';
import { messageError } from './errors';
import { pendingPermissions, record } from './normalize';
import type { Json } from './normalize';
import styles from './requests.module.css';

export const Requests = memo(function Requests({ sessionId }: { sessionId: string }) {
  const { live, state, unavailable } = useDemo((store) => ({
    live: store.live, state: store.snapshot?.sessionData[sessionId]?.agentState,
    unavailable: store.snapshot?.connection !== 'connected' || store.snapshot?.offline,
  }));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!live || !state) return null;
  const permissions = pendingPermissions(state);
  const forms = Object.entries(record(state.communications)).filter(
    ([id]) => !record(state.completedCommunications)[id],
  );
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
          <pre>{JSON.stringify(request.arguments, null, 2)}</pre>
          {request.tool === 'AskUserQuestion' ? (
            <p>Answer this question in the Happy app.</p>
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
            </div>
          )}
        </section>
      ))}
      {forms.map(([id, form]) =>
        record(form).kind === 'form' && Array.isArray(record(form).form?.questions) ? (
          <QuestionForm
            key={id}
            form={record(form)}
            busy={!!busy || unavailable}
            onSubmit={(answers) => void run(id, () => live.answerQuestions(sessionId, id, answers))}
          />
        ) : (
          <section className={styles.card} key={id}>
            <strong>{record(form).title || 'The agent needs a reply'}</strong>
            <p>Answer this request in the Happy app.</p>
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
function QuestionForm({
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
            Object.fromEntries(
              Object.entries(answers).map(([id, answer]) => [
                id,
                {
                  options: answer.options,
                  ...(answer.custom.trim() ? { custom: answer.custom.trim() } : {}),
                },
              ]),
            ),
          );
      }}
    >
      <fieldset disabled={busy}>
        {questions.map((question) => (
          <section key={question.id}>
            <strong>{question.header}</strong>
            <p>{question.question}</p>
            {(question.options || []).map((option: Json) => (
              <label key={option.label} className={styles.option} data-focus-frame>
                <input
                  type={question.multiSelect ? 'checkbox' : 'radio'}
                  name={question.id}
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
