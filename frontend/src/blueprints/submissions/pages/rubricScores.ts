import {uiText} from "../../../shared/i18n/translate";
export type Criterion = {
  id: string;
  title: string;
  max_score: string;
};

export type Mark = {
  criterion_id: string;
  title: string;
  score: string;
  max_score: string;
};

export function readScore(raw: string, max: string, label: string): number {
  const text = raw.trim().replace(',', '.');

  if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) > Number(max)) {
    throw new Error(
      uiText("{0}: nhập từ 0 đến {1}, tối đa 2 chữ số thập phân.",[label,max]),
    );
  }

  return Math.round(Number(text) * 100);
}

export function rubricResult(
  criteria: Criterion[],
  inputs: Record<string, string>,
) {
  let cents = 0;

  const scores = criteria.map(item => {
    const mark = readScore(inputs[item.id] ?? '', item.max_score, item.title);
    cents += mark;

    return {
      criterion_id: item.id,
      score: (mark / 100).toFixed(2),
    };
  });

  return { scores, total: (cents / 100).toFixed(2) };
}