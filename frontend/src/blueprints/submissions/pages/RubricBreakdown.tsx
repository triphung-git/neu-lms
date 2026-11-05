import {uiText} from "../../../shared/i18n/translate";
import type { Mark } from './rubricScores';
import './RubricGrading.css';

export function RubricBreakdown({ marks }: { marks?: Mark[] }) {
  if (!marks?.length) return null;

  return (
    <dl className="rubric-marks" aria-label={uiText("Điểm từng tiêu chí")}>
      {marks.map(mark => (
        <div key={mark.criterion_id}>
          <dt>{mark.title}</dt>
          <dd>{mark.score} / {mark.max_score}</dd>
        </div>
      ))}
    </dl>
  );
}