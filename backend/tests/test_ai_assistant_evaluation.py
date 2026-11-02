
from types import SimpleNamespace

import pytest

from ai_assistant.evaluation_metrics import (
    hit_at_k,
    precision_at_k,
    ranked_unique_pages,
    recall_at_k,
    reciprocal_rank_at_k,
)


def make_results(pages):
    return [
        SimpleNamespace(page_number=page)
        for page in pages
    ]


def test_precision_at_5():
    results = make_results([4, 3, 5, 6, 8])

    score = precision_at_k(
        results,
        relevant_pages=[4],
        k=5,
    )

    assert score == pytest.approx(0.2)


def test_recall_at_5():
    results = make_results([4, 3, 5, 6, 8])

    score = recall_at_k(
        results,
        relevant_pages=[4],
        k=5,
    )

    assert score == pytest.approx(1.0)


def test_mrr_when_relevant_page_is_second():
    results = make_results([6, 4, 3, 5])

    score = reciprocal_rank_at_k(
        results,
        relevant_pages=[4],
        k=5,
    )

    assert score == pytest.approx(0.5)


def test_hit_at_5():
    results = make_results([6, 4, 3])

    score = hit_at_k(
        results,
        relevant_pages=[4],
        k=5,
    )

    assert score == 1.0


def test_duplicate_pages_are_counted_once():
    results = make_results([4, 4, 6, 6, 3])

    pages = ranked_unique_pages(results)

    assert pages == [4, 6, 3]

    score = precision_at_k(
        results,
        relevant_pages=[4],
        k=3,
    )

    assert score == pytest.approx(1 / 3)


def test_mrr_is_zero_when_no_relevant_page_found():
    results = make_results([6, 3, 5])

    score = reciprocal_rank_at_k(
        results,
        relevant_pages=[4],
        k=5,
    )

    assert score == 0.0


def test_metrics_reject_invalid_k():
    with pytest.raises(ValueError):
        precision_at_k(
            make_results([4]),
            [4],
            k=0,
        )
