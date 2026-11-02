from ai_assistant.retrieval import (
    _bm25_scores,
    filter_relevant_candidates,
    normalize_text,
    tokenize,
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
