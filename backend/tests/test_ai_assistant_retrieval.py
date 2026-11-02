from ai_assistant.retrieval import (
    _bm25_scores,
    filter_relevant_candidates,
    normalize_text,
    tokenize,
    _title_relevance_boost,
)

from ai_assistant.embeddings import (
    cosine_similarity,
    prepare_document_input,
    prepare_query_input,
)


def make_candidate(text, page=1):
    """Tạo candidate giả lập để kiểm thử retrieval."""
    return (
        {"id": "test-material"},
        page,
        text,
    )


def test_rejects_unrelated_accounting_question():
    query = (
        "quy trình hạch toán nghiệp vụ "
        "nhập khẩu hàng hóa"
    )

    candidates = [
        make_candidate(
            "Python Method thực hành vòng lặp "
            "và sử dụng thư viện Pandas."
        )
    ]

    results = filter_relevant_candidates(
        query,
        candidates
    )

    assert results == []


def test_keeps_relevant_email_question():
    query = (
        "Tình huống II yêu cầu nhập email "
        "và kiểm tra định dạng email bằng Regex"
    )

    candidates = [
        make_candidate(
            "Tình huống II: Viết hàm yêu cầu "
            "người dùng nhập địa chỉ email từ bàn phím. "
            "Kiểm tra định dạng email bằng biểu thức "
            "chính quy Regex."
        )
    ]

    results = filter_relevant_candidates(
        query,
        candidates
    )

    assert len(results) == 1


def test_filter_is_accent_insensitive():
    query = "kiểm tra định dạng email"

    candidates = [
        make_candidate(
            "Kiem tra dinh dang email bang Regex"
        )
    ]

    results = filter_relevant_candidates(
        query,
        candidates
    )

    assert len(results) == 1


def test_filter_rejects_stopword_only_query():
    query = "và là của trong"

    candidates = [
        make_candidate(
            "Python Method và thư viện Pandas"
        )
    ]

    results = filter_relevant_candidates(
        query,
        candidates
    )

    assert results == []


def test_bm25_ranks_relevant_document_higher():
    documents = [
        "Thực hành Python với vòng lặp và hàm",
        "Quản trị cơ sở dữ liệu SQL",
        "Thống kê dữ liệu bằng Pandas",
    ]

    scores = _bm25_scores(
        "Python vòng lặp hàm",
        documents
    )

    assert scores[0] > scores[1]
    assert scores[0] > scores[2]


def test_bm25_returns_zero_for_unrelated_documents():
    scores = _bm25_scores(
        "hạch toán nhập khẩu",
        [
            "Python Method và vòng lặp",
            "Thư viện Pandas và xử lý dữ liệu",
        ]
    )

    assert scores == [0.0, 0.0]


def test_bm25_prefers_exact_vietnamese_phrase():
    documents = [
        "Cơ sở dữ liệu quan hệ",
        "Cơ chế sở hữu dữ liệu quan hệ",
    ]

    scores = _bm25_scores(
        "cơ sở dữ liệu quan hệ",
        documents
    )

    assert scores[0] > scores[1]


def test_bm25_matches_vietnamese_phrase_without_diacritics():
    scores = _bm25_scores(
        "cơ sở dữ liệu",
        [
            "co so du lieu"
        ]
    )

    assert scores[0] > 0


def test_matching_material_title_gets_higher_boost():
    query = "Python kiểm tra email bằng Regex"

    matching_title = (
        "Python Regex kiểm tra email"
    )

    unrelated_title = (
        "Quản trị cơ sở dữ liệu"
    )

    matching_score = _title_relevance_boost(
        query,
        matching_title
    )

    unrelated_score = _title_relevance_boost(
        query,
        unrelated_title
    )

    assert matching_score > unrelated_score
    assert matching_score <= 1.25


def test_empty_query_has_neutral_title_boost():
    score = _title_relevance_boost(
        "và là của trong",
        "Python Regex"
    )

    assert score == 1.0

import pytest


def test_prepare_query_input():
    result = prepare_query_input(
        "Kiểm tra định dạng email bằng Python Regex"
    )

    assert result.startswith(
        "task: question answering | query:"
    )


def test_prepare_document_input():
    result = prepare_document_input(
        "Nội dung bài học về Python Regex",
        "Chương 1 - Python Method",
    )

    assert "title: Chương 1 - Python Method" in result
    assert "text: Nội dung bài học" in result


def test_cosine_similarity_identical_vectors():
    score = cosine_similarity(
        [1.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
    )

    assert score == pytest.approx(1.0)


def test_cosine_similarity_orthogonal_vectors():
    score = cosine_similarity(
        [1.0, 0.0],
        [0.0, 1.0],
    )

    assert score == pytest.approx(0.0)


def test_cosine_similarity_rejects_different_dimensions():
    with pytest.raises(ValueError):
        cosine_similarity(
            [1.0, 0.0],
            [1.0, 0.0, 0.0],
        )
        

def test_bm25_expands_email_synonym():
    query = (
        "xác thực địa chỉ thư điện tử"
    )

    documents = [
        (
            "Người dùng nhập địa chỉ email. "
            "Kiểm tra định dạng email bằng Regex."
        ),
        (
            "Hệ thống ATM cho phép người dùng "
            "tạo tài khoản và thực hiện giao dịch rút tiền."
        ),
    ]

    scores = _bm25_scores(query, documents)

    assert scores[0] > scores[1]


def test_filter_keeps_email_chunk_for_synonym_query():
    query = (
        "Làm thế nào để xác thực địa chỉ "
        "thư điện tử do người dùng nhập?"
    )

    email_candidate = make_candidate(
        "Tình huống II: Người dùng nhập một "
        "địa chỉ email từ bàn phím. "
        "Kiểm tra định dạng email bằng Regex."
    )

    atm_candidate = make_candidate(
        "Tình huống IV: Hệ thống ATM cho phép "
        "người dùng tạo tài khoản và thực hiện "
        "giao dịch rút tiền."
    )

    results = filter_relevant_candidates(
        query,
        [
            atm_candidate,
            email_candidate,
        ]
    )

    assert email_candidate in results
    assert atm_candidate not in results
    assert results == [email_candidate]
