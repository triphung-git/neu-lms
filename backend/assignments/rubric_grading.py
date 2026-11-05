from decimal import Decimal

from rest_framework import serializers


class CriterionScoreInput(serializers.Serializer):
    criterion_id = serializers.UUIDField()
    score = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        min_value=Decimal("0"),
    )


class CriterionScoreOutput(CriterionScoreInput):
    title = serializers.CharField()
    max_score = serializers.DecimalField(max_digits=5, decimal_places=2)


def resolve_grade(assignment, values):
    if "rubric_scores" not in values:
        score = values["score"]
        if score > assignment.total_score:
            raise serializers.ValidationError({"score": "Điểm vượt quá tổng điểm của bài tập."})
        return score, []

    entries = values["rubric_scores"]
    scores = {entry["criterion_id"]: entry["score"] for entry in entries}
    criteria = list(assignment.rubric_criteria.all())

    expected_ids = {criterion.pk for criterion in criteria}
    duplicate_ids = len(entries) != len(scores)

    if not criteria or duplicate_ids or set(scores) != expected_ids:
        raise serializers.ValidationError(
            {"rubric_scores": "Cần nhập đúng một điểm cho mỗi tiêu chí của bài tập."}
        )

    total = Decimal("0.00")
    breakdown = []

    for criterion in criteria:
        score = scores[criterion.pk]

        if score > criterion.max_score:
            raise serializers.ValidationError(
                {"rubric_scores": f"{criterion.title}: tối đa {criterion.max_score} điểm."}
            )

        total += score
        breakdown.append(
            {
                "criterion_id": str(criterion.pk),
                "title": criterion.title,
                "max_score": str(criterion.max_score),
                "score": str(score),
            }
        )

    return total, breakdown
