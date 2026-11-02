
from __future__ import annotations


def ranked_unique_pages(results) -> list[int]:
    """
    Convert retrieved chunks into an ordered list of unique pages.
    Preserve the original retrieval order.
    """

    pages = []
    seen = set()

    for result in results:
        page = result.page_number

        if page is None or page in seen:
            continue

        seen.add(page)
        pages.append(page)

    return pages


def precision_at_k(
    results,
    relevant_pages: list[int],
    k: int = 5,
) -> float:
    """
    Precision@K = relevant unique pages in top K / K.
    """

    if k <= 0:
        raise ValueError("k must be positive")

    relevant = set(relevant_pages)
    retrieved = ranked_unique_pages(results)[:k]

    hits = sum(
        1
        for page in retrieved
        if page in relevant
    )

    return hits / k


def recall_at_k(
    results,
    relevant_pages: list[int],
    k: int = 5,
) -> float:
    """
    Recall@K = relevant pages retrieved in top K / all
    known relevant pages.
    """

    if k <= 0:
        raise ValueError("k must be positive")

    relevant = set(relevant_pages)

    if not relevant:
        return 0.0

    retrieved = set(
        ranked_unique_pages(results)[:k]
    )

    return len(relevant.intersection(retrieved)) / len(relevant)


def reciprocal_rank_at_k(
    results,
    relevant_pages: list[int],
    k: int = 5,
) -> float:
    """
    Reciprocal rank of the first relevant page in top K.
    """

    if k <= 0:
        raise ValueError("k must be positive")

    relevant = set(relevant_pages)
    retrieved = ranked_unique_pages(results)[:k]

    for rank, page in enumerate(retrieved, start=1):
        if page in relevant:
            return 1.0 / rank

    return 0.0


def hit_at_k(
    results,
    relevant_pages: list[int],
    k: int = 5,
) -> float:
    """
    Returns 1 if at least one relevant page is found in top K.
    """

    return float(
        reciprocal_rank_at_k(
            results,
            relevant_pages,
            k,
        ) > 0
    )
