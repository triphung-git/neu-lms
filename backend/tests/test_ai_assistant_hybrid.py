
from ai_assistant.hybrid_retrieval import reciprocal_rank_fusion
from ai_assistant.retrieval import RetrievedChunk

import pytest

from ai_assistant.hybrid_retrieval import (
    reciprocal_rank_fusion,
    extract_situation_number,
)

def make_chunk(
    material_id,
    text,
    page_number=1,
    score=1.0,
):
    return RetrievedChunk(
        citation_id="",
        material_id=material_id,
        material_title="Python Method",
        course_code="WEB101",
        course_name="Lap trinh web",
        file_name="python.pdf",
        page_number=page_number,
        text=text,
        score=score,
    )


def test_rrf_merges_lexical_and_semantic_results():
    common = make_chunk("M1", "Python Regex")
    lexical_only = make_chunk("M2", "Python loops")
    semantic_only = make_chunk("M3", "Email validation")

    results = reciprocal_rank_fusion(
        lexical_results=[common, lexical_only],
        semantic_results=[common, semantic_only],
        top_k=5,
    )

    assert len(results) == 3
    assert results[0].text == "Python Regex"


def test_rrf_deduplicates_same_chunk():
    common = make_chunk("M1", "Python Regex")

    results = reciprocal_rank_fusion(
        lexical_results=[common],
        semantic_results=[common],
        top_k=5,
    )

    assert len(results) == 1


def test_rrf_assigns_sequential_citation_ids():
    results = reciprocal_rank_fusion(
        lexical_results=[
            make_chunk("M1", "Python Regex"),
            make_chunk("M2", "Python loops"),
        ],
        semantic_results=[],
        top_k=5,
    )

    assert [item.citation_id for item in results] == [
        "S1",
        "S2",
    ]


def test_rrf_respects_top_k():
    results = reciprocal_rank_fusion(
        lexical_results=[
            make_chunk("M1", "Python Regex"),
            make_chunk("M2", "Python loops"),
            make_chunk("M3", "Python functions"),
        ],
        semantic_results=[],
        top_k=2,
    )

    assert len(results) == 2


def test_rrf_handles_empty_results():
    results = reciprocal_rank_fusion(
        lexical_results=[],
        semantic_results=[],
        top_k=5,
    )

    assert results == []


def test_rrf_rewards_chunks_found_by_both_methods():
    common = make_chunk("M1", "Python Regex")
    lexical_only = make_chunk("M2", "Python loops")
    semantic_only = make_chunk("M3", "Email validation")

    results = reciprocal_rank_fusion(
        lexical_results=[common, lexical_only],
        semantic_results=[common, semantic_only],
        top_k=5,
    )

    assert results[0].text == "Python Regex"
    assert results[0].score > results[1].score

@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Tình huống I", "1"),
        ("Tình huống II", "2"),
        ("Tình huống III", "3"),
        ("Tình huống IV", "4"),
        ("Tình huống V", "5"),
        ("Tình huống 2", "2"),
        ("Tình huốngV", "5"),
        ("Tình huốngIII", "3"),
        ("Tình huống IV:", "4"),
    ],
)
def test_extract_situation_number_handles_ocr_spacing(
    text,
    expected,
):
    assert extract_situation_number(text) == expected