import { useText } from "../i18n";
import { useState } from 'react';
import { Button } from '../components/ui';
import { QuestionForm } from '../happy/Requests';
import type { Json } from '../happy/normalize';
import styles from '../happy/requests.module.css';

const questions = [
  {
    id: 'approach',
    header: 'Implementation · choose one',
    question: 'Which approach should the agent use?',
    options: [
      { label: 'Focused patch', description: 'Keep the change small and preserve the public API.' },
      { label: 'Complete flow', description: 'Update the entire interaction.' },
    ],
  },
  {
    id: 'validation',
    header: 'Validation · choose any',
    question: 'Which checks should the agent run?',
    multiSelect: true,
    options: [
      { label: 'Browser checks', description: 'Verify Chromium and WebKit.' },
      { label: 'Phone checks', description: 'Check touch controls and landscape scrolling.' },
      { label: 'Keyboard checks', description: 'Check focus, arrow keys, and the space bar.' },
    ],
  },
];

export function DemoQuestions() {
  const t = useText();
  const [answers, setAnswers] = useState<Json | null>();
  return (
    <div className={styles.requests} aria-label={t("Agent requests")}>
      {answers === undefined ? (
        <section className={styles.card}>
          <strong>{t("AskUserQuestion")}</strong>
          <p>{t("Interactive demo · select options, then send your answers.")}</p>
          <QuestionForm form={{ form: { questions } }} busy={false} onSubmit={setAnswers} />
        </section>
      ) : (
        <section className={styles.card} role="status" aria-label={t("Demo answer result")}>
          <strong>{answers === null ? t("Demo questions dismissed") : t("Demo answers sent")}</strong>
          {answers && questions.map(question => {
            const answer = answers[question.id];
            return <p key={question.id}><strong>{question.header}</strong><br />
              {[...(answer?.options || []), ...(answer?.custom ? [answer.custom] : [])].join(', ')}
            </p>;
          })}
          <p>{t("This demo does not send a request to an agent.")}</p>
          <div className={styles.actions}>
            <Button onClick={() => setAnswers(undefined)}>{t("Try again")}</Button>
          </div>
        </section>
      )}
    </div>
  );
}
