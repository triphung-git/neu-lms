from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from rest_framework.exceptions import ValidationError

from assignments.grading_api import GradeInput
from assignments.rubric_grading import resolve_grade


def test_rubric_total_and_validation():
    first = SimpleNamespace(
        pk=uuid4(),
        title="Nội dung",
        max_score=Decimal("6.00"),
    )
    second = SimpleNamespace(
        pk=uuid4(),
        title="Trình bày",
        max_score=Decimal("4.00"),
    )
    assignment = SimpleNamespace(rubric_criteria=SimpleNamespace(all=lambda: [first, second]))

    def calculate(entries):
        form = GradeInput(
            data={
                "status": "draft",
                "expected_version": 0,
                "rubric_scores": entries,
            }
        )
        form.is_valid(raise_exception=True)
        return resolve_grade(assignment, form.validated_data)

    a = {"criterion_id": str(first.pk), "score": "5.25"}
    b = {"criterion_id": str(second.pk), "score": "3.50"}

    # Gửi đảo thứ tự vẫn ghép đúng điểm với đúng tiêu chí.
    total, snapshot = calculate([b, a])
    assert total == Decimal("8.75")
    assert [item["title"] for item in snapshot] == ["Nội dung", "Trình bày"]
    assert [item["score"] for item in snapshot] == ["5.25", "3.50"]

    invalid_cases = [
        [a],  # Thiếu tiêu chí
        [a, a],  # Trùng tiêu chí
        [a, {**b, "score": "4.01"}],  # Vượt điểm tối đa
        [a, {**b, "criterion_id": str(uuid4())}],  # Sai mã tiêu chí
    ]

    for entries in invalid_cases:
        with pytest.raises(ValidationError):
            calculate(entries)
