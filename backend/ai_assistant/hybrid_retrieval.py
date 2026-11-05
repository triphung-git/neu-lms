from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import replace

from django.conf import settings
from django.db.models import F

from ai_assistant.embeddings import (
    EmbeddingError,
    cosine_similarity,
    embed_text,
)
from ai_assistant.models import MaterialChunkEmbedding
from files.models import FilePurpose, FileStatus
from materials.statuses import ExtractionStatus

from .retrieval import (
    DEFAULT_TOP_K,
    RetrievedChunk,
    normalize_text,
    retrieve_course_chunks,
)

SITUATION_PATTERN = re.compile(r"\btinh\s+huong\s*(iv|iii|ii|i|v|[1-5])\b")

ROMAN_TO_NUMBER = {
    "i": "1",
    "ii": "2",
    "iii": "3",
    "iv": "4",
    "v": "5",
}


def extract_situation_number(text: str):
    """
    Nhận diện nhãn Tình huống I, II, III, IV, V
    hoặc Tình huống 1, 2, 3, 4, 5.
    """

    normalized = normalize_text(text or "")
    match = SITUATION_PATTERN.search(normalized)

    if not match:
        return None

    label = match.group(1)
    return ROMAN_TO_NUMBER.get(label, label)


def filter_situation_mismatches(query: str, chunks: list):
    """
    Nếu câu hỏi chỉ rõ một tình huống,
    loại các chunk ghi rõ tình huống khác.

    Chunk không có nhãn tình huống vẫn được giữ lại
    để tránh loại nhầm nội dung khi tiêu đề bị tách riêng.
    """

    expected = extract_situation_number(query)

    if expected is None:
        return chunks

    filtered = []

    for chunk in chunks:
        normalized = normalize_text(chunk.text or "")

        labels = {
            ROMAN_TO_NUMBER.get(match.group(1), match.group(1))
            for match in SITUATION_PATTERN.finditer(normalized)
        }

        if not labels or expected in labels:
            filtered.append(chunk)

    return filtered


logger = logging.getLogger(__name__)

RRF_K = 60
MAX_RANKED_CANDIDATES = 50


def _chunk_identity(chunk: RetrievedChunk) -> tuple:
    """
    Stable identity used to merge BM25 and vector results.
    """

    return (
        chunk.material_id,
        chunk.file_name,
        chunk.page_number,
        chunk.text,
    )


def reciprocal_rank_fusion(
    lexical_results: list[RetrievedChunk],
    semantic_results: list[RetrievedChunk],
    top_k: int = DEFAULT_TOP_K,
) -> list[RetrievedChunk]:
    """
    Merge lexical and semantic rankings using RRF.

    RRF(d) = sum(1 / (k + rank))

    Tie-breaking:
    1. Higher RRF score first.
    2. Better semantic rank first.
    3. Better lexical rank first.
    """

    fused_scores = {}
    chunk_lookup = {}

    lexical_ranks = {}
    semantic_ranks = {}

    result_lists = [
        ("lexical", lexical_results),
        ("semantic", semantic_results),
    ]

    for source, ranked_results in result_lists:
        for rank, chunk in enumerate(
            ranked_results,
            start=1,
        ):
            key = _chunk_identity(chunk)

            fused_scores[key] = fused_scores.get(key, 0.0) + 1.0 / (RRF_K + rank)

            chunk_lookup.setdefault(key, chunk)

            if source == "semantic":
                semantic_ranks[key] = min(
                    rank,
                    semantic_ranks.get(key, rank),
                )
            else:
                lexical_ranks[key] = min(
                    rank,
                    lexical_ranks.get(key, rank),
                )

    # Sort by RRF score first.
    # When scores are equal, prioritize semantic rank.
    ranked = sorted(
        fused_scores.keys(),
        key=lambda key: (
            -fused_scores[key],
            semantic_ranks.get(key, float("inf")),
            lexical_ranks.get(key, float("inf")),
        ),
    )

    limit = max(1, min(int(top_k), 10))

    results = []

    for index, key in enumerate(
        ranked[:limit],
        start=1,
    ):
        chunk = chunk_lookup[key]

        results.append(
            replace(
                chunk,
                citation_id=f"S{index}",
                score=round(fused_scores[key], 8),
            )
        )

    return results


def _expected_content_hash(
    course_code: str,
    material_title: str,
    text: str,
) -> str:
    """
    Must match the hash used by the indexing command.
    """

    document_title = f"{course_code} - {material_title}"

    return hashlib.sha256(f"{document_title}\0{text}".encode()).hexdigest()


def _get_semantic_results(
    course,
    question: str,
    top_k: int,
) -> list[RetrievedChunk]:
    """
    Retrieve published, clean, current-version vectors
    belonging to the requested course only.
    """

    model = settings.AI_EMBEDDING_MODEL
    dimensions = settings.AI_EMBEDDING_DIMENSIONS

    threshold = settings.AI_RAG_MIN_COSINE_SIMILARITY

    max_candidates = settings.AI_RAG_MAX_VECTOR_CANDIDATES

    if not 0.0 <= threshold <= 1.0:
        raise ValueError("AI_RAG_MIN_COSINE_SIMILARITY must be between 0 and 1.")

    if max_candidates <= 0:
        raise ValueError("AI_RAG_MAX_VECTOR_CANDIDATES must be positive.")

    eligible = (
        MaterialChunkEmbedding.objects.filter(
            embedding_model=model,
            dimensions=dimensions,
            extraction__status=ExtractionStatus.SUCCESS,
            extraction__stored_file__status=FileStatus.CLEAN,
            extraction__stored_file__purpose=FilePurpose.COURSE_MATERIAL,
            extraction__stored_file__course=course,
            extraction__material_version__is_published=True,
            extraction__material_version__material__course=course,
            extraction__material_version__material__is_hidden=False,
            extraction__material_version__material__published_version_id=F(
                "extraction__material_version_id"
            ),
            extraction__material_file__material_version_id=F("extraction__material_version_id"),
            extraction__material_file__file_id=F("extraction__stored_file_id"),
        )
        .filter(extraction__file_hash=F("extraction__material_file__sha256_hash"))
        .filter(extraction__file_hash=F("extraction__stored_file__sha256_hash"))
        .exclude(extraction__file_hash="")
    )

    # Avoid embedding API calls if no index exists.
    if not eligible.exists():
        return []

    query_vector = embed_text(
        question,
        is_query=True,
    )

    rows = list(
        eligible.values(
            "embedding",
            "dimensions",
            "content_hash",
            "page_number",
            "text",
            "extraction__id",
            "extraction__material_version_id",
            "extraction__stored_file_id",
            "extraction__file_hash",
            "extraction__material_version__material__id",
            "extraction__material_version__material__title",
            "extraction__material_version__material__course__code",
            "extraction__material_version__material__course__name",
            "extraction__material_file__file_name",
            "extraction__stored_file__file_name",
        ).order_by(
            "extraction__material_version__material__title",
            "extraction__material_file__position",
            "chunk_index",
        )[:max_candidates]
    )

    if not rows:
        return []

    if len(rows) == max_candidates:
        logger.warning(
            "Hybrid retrieval reached vector candidate limit: %s",
            max_candidates,
        )

    ranked = []

    for row in rows:
        text = row["text"]

        if not isinstance(text, str) or not text.strip():
            continue

        course_code = row["extraction__material_version__material__course__code"]

        material_title = row["extraction__material_version__material__title"]

        # Ignore stale vectors whose source text or title changed.
        expected_hash = _expected_content_hash(
            course_code,
            material_title,
            text,
        )

        if row["content_hash"] != expected_hash:
            continue

        vector = row["embedding"]

        if not isinstance(vector, list):
            continue

        if len(vector) != dimensions:
            continue

        try:
            similarity = cosine_similarity(
                query_vector,
                vector,
            )
        except (TypeError, ValueError):
            continue

        if similarity < threshold:
            continue

        file_name = (
            row["extraction__material_file__file_name"] or row["extraction__stored_file__file_name"]
        )

        chunk = RetrievedChunk(
            version_id=str(row["extraction__material_version_id"]),
            file_id=str(row["extraction__stored_file_id"]),
            file_hash=row["extraction__file_hash"],
            citation_id="",
            material_id=str(row["extraction__material_version__material__id"]),
            material_title=material_title,
            course_code=course_code,
            course_name=row["extraction__material_version__material__course__name"],
            file_name=file_name,
            page_number=row["page_number"],
            text=text,
            score=similarity,
        )

        ranked.append(chunk)

    ranked.sort(
        key=lambda chunk: chunk.score,
        reverse=True,
    )

    return ranked[: min(MAX_RANKED_CANDIDATES, max(1, top_k * 5))]


def retrieve_course_chunks_hybrid(
    course,
    question: str,
    top_k: int = DEFAULT_TOP_K,
) -> list[RetrievedChunk]:
    """
    Hybrid retrieval with safe BM25 fallback.

    If Gemini Embeddings is unavailable, the existing BM25
    retriever remains operational.
    """

    top_k = max(1, min(int(top_k), 10))

    lexical_results = retrieve_course_chunks(
        course,
        question,
        top_k=10,
    )

    try:
        semantic_results = _get_semantic_results(
            course,
            question,
            top_k=top_k,
        )

    except EmbeddingError:
        logger.warning(
            "Semantic retrieval unavailable. Falling back to BM25.",
            exc_info=True,
        )

        lexical_results = filter_situation_mismatches(
            question,
            lexical_results,
        )
        return lexical_results[:top_k]

    except (ValueError, TypeError):
        logger.warning(
            "Invalid semantic retrieval configuration or vector data. Falling back to BM25.",
            exc_info=True,
        )

        lexical_results = filter_situation_mismatches(
            question,
            lexical_results,
        )
        return lexical_results[:top_k]

    # Filter situation labels before merging BM25 and Semantic.
    lexical_results = filter_situation_mismatches(
        question,
        lexical_results,
    )

    semantic_results = filter_situation_mismatches(
        question,
        semantic_results,
    )

    return reciprocal_rank_fusion(
        lexical_results=lexical_results,
        semantic_results=semantic_results,
        top_k=top_k,
    )
