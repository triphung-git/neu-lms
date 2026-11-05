from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass

from django.db.models import F
from django.db.models.functions import Substr

from files.models import FilePurpose, FileStatus
from materials.models import MaterialFileExtraction
from materials.statuses import ExtractionStatus

MAX_EXTRACTIONS_PER_QUERY = 250
MAX_DOCUMENT_CHARS = 100_000

CHUNK_SIZE_CHARS = 1200
CHUNK_OVERLAP_CHARS = 180

DEFAULT_TOP_K = 5

# Minimum lexical relevance requirements
MIN_QUERY_COVERAGE = 0.30
MIN_QUERY_OVERLAP_TERMS = 2

PAGE_MARKER_RE = re.compile(r"---\s*\[Trang\s+(\d+)\]\s*---", re.IGNORECASE)

WORD_RE = re.compile(r"[a-z0-9]+", re.IGNORECASE)


STOP_WORDS = {
    "va",
    "la",
    "cua",
    "cho",
    "trong",
    "mot",
    "nhung",
    "cac",
    "duoc",
    "khi",
    "thi",
    "theo",
    "voi",
    "tu",
    "den",
    "nay",
    "do",
    "co",
    "khong",
    "gi",
    "nao",
    "tai",
    "sao",
    "nhu",
    "ve",
    "de",
    "hay",
    "toi",
    "ban",
    "em",
    "anh",
    "chi",
    "tren",
    "duoi",
    "giua",
}


@dataclass(frozen=True)
class RetrievedChunk:
    citation_id: str
    material_id: str

    material_title: str
    course_code: str
    course_name: str

    file_name: str
    page_number: int | None

    text: str
    score: float
    version_id: str = ""
    file_id: str = ""
    file_hash: str = ""

    def to_source_dict(self):

        return {
            "id": self.citation_id,
            **(
                {
                    "version_id": self.version_id,
                    "file_id": self.file_id,
                    "file_hash": self.file_hash,
                }
                if self.version_id
                else {}
            ),
            "material_id": self.material_id,
            "material_title": self.material_title,
            "course_code": self.course_code,
            "course_name": self.course_name,
            "file_name": self.file_name,
            "page_number": self.page_number,
            "excerpt": self.text,
        }


def normalize_text(value: str) -> str:

    normalized = unicodedata.normalize("NFKD", value.casefold())

    without_marks = "".join(char for char in normalized if not unicodedata.combining(char))

    return without_marks.replace("đ", "d")


def tokenize(value: str) -> list[str]:
    return [
        token
        for token in (
            _normalize_search_token(item) for item in WORD_RE.findall(normalize_text(value))
        )
        if len(token) > 1 and token not in STOP_WORDS
    ]


def _normalize_search_token(token: str) -> str:
    """Chuan hoa mot so bien the so nhieu tieng Anh."""
    if len(token) > 4 and token.endswith("ies"):
        return token[:-3] + "y"

    if len(token) > 4 and token.endswith(("sses", "shes", "ches", "xes", "zes")):
        return token[:-2]

    if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]

    return token


def _bm25_terms(value: str) -> list[str]:
    """
    Tạo tập đặc trưng cho BM25:
    - Unigram: từng từ riêng lẻ.
    - Bigram: hai từ liên tiếp để nhận diện cụm từ.

    Ví dụ:
    'cơ sở dữ liệu'
    -> co, so, du, lieu
    -> __bi__co_so
    -> __bi__so_du
    -> __bi__du_lieu
    """

    normalized = normalize_text(value)
    raw_tokens = [_normalize_search_token(token) for token in WORD_RE.findall(normalized)]

    # Giữ các từ có ý nghĩa tìm kiếm.
    unigrams = [token for token in raw_tokens if len(token) > 1 and token not in STOP_WORDS]

    # Chỉ tạo bigram từ hai từ liên tiếp trong văn bản gốc.
    bigrams = []

    for left, right in zip(raw_tokens, raw_tokens[1:], strict=False):
        if len(left) > 1 and len(right) > 1 and left not in STOP_WORDS and right not in STOP_WORDS:
            bigrams.append(f"__bi__{left}_{right}")

    return unigrams + bigrams


QUERY_SYNONYMS = {
    "thu dien tu": (
        "email",
        "e-mail",
    ),
    "dia chi thu dien tu": (
        "email address",
        "email",
    ),
    "xac thuc": (
        "kiem tra",
        "validate",
    ),
    "xac minh": (
        "kiem tra",
        "verify",
    ),
    "kiem chung": (
        "verify",
        "validation",
    ),
    "phuong thuc": ("method", "methods"),
}


def _expanded_query_terms(query: str) -> set[str]:
    """
    Expand Vietnamese query terms with controlled synonyms.

    Original query terms are retained. Synonyms are additional
    retrieval features and do not change the source document.
    """

    normalized = normalize_text(query)

    expanded_terms = set(_bm25_terms(query))

    for phrase, alternatives in QUERY_SYNONYMS.items():
        if phrase in normalized:
            for alternative in alternatives:
                expanded_terms.update(_bm25_terms(alternative))

    # Map Vietnamese chapter references to English headings.
    if "chuong hai" in normalized or "chuong 2" in normalized:
        expanded_terms.update(_bm25_terms("chapter ii"))
        expanded_terms.update(_bm25_terms("chapter 2"))

    return expanded_terms


def _required_synonym_groups(query: str) -> list[set[str]]:
    """
    Return synonym groups triggered by phrases in the query.

    Each group requires at least one matching term in a document.
    """

    normalized = normalize_text(query)
    groups = []

    for phrase, alternatives in QUERY_SYNONYMS.items():
        if phrase not in normalized:
            continue

        terms = set()

        for alternative in alternatives:
            terms.update(_bm25_terms(alternative))

        if terms and terms not in groups:
            groups.append(terms)

    return groups


def _is_chapter_heading_query(query: str) -> bool:
    normalized = normalize_text(query)
    phrases = (
        "noi dung chuong hai",
        "noi dung chuong 2",
        "chuong hai",
        "chuong 2",
        "chapter ii",
        "chapter 2",
    )
    return any(phrase in normalized for phrase in phrases)


def filter_relevant_candidates(query: str, candidates: list):
    """Filter relevant passages and prioritize explicit chapter queries."""
    original_query_terms = set(tokenize(query))
    expanded_query_terms = _expanded_query_terms(query)
    required_groups = _required_synonym_groups(query)

    if not original_query_terms:
        return []

    chapter_query = _is_chapter_heading_query(query)

    if len(original_query_terms) <= 2:
        min_overlap = 1
    else:
        min_overlap = max(
            MIN_QUERY_OVERLAP_TERMS,
            math.ceil(len(original_query_terms) * MIN_QUERY_COVERAGE),
        )

    relevant = []

    for candidate in candidates:
        document_terms = set(_bm25_terms(candidate[2]))

        if not all(bool(group.intersection(document_terms)) for group in required_groups):
            continue

        overlap = expanded_query_terms.intersection(document_terms)
        if len(overlap) < min_overlap:
            continue

        if chapter_query:
            heading_terms = set(_bm25_terms(candidate[2][:250]))
            has_chapter_heading = "chapter" in heading_terms and bool({"ii", "2"} & heading_terms)
            if not has_chapter_heading:
                continue

        relevant.append(candidate)

    return relevant


def _split_page_blocks(text: str):

    matches = list(PAGE_MARKER_RE.finditer(text))

    if not matches:
        return [(None, text.strip())] if text.strip() else []

    blocks = []

    for index, match in enumerate(matches):
        start = match.end()

        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)

        page_text = text[start:end].strip()

        if page_text:
            blocks.append((int(match.group(1)), page_text))

    return blocks


def _split_long_text(text: str) -> list[str]:

    text = text.strip()

    if not text:
        return []

    if len(text) <= CHUNK_SIZE_CHARS:
        return [text]

    chunks = []
    start = 0

    while start < len(text):
        hard_end = min(start + CHUNK_SIZE_CHARS, len(text))

        end = hard_end

        if hard_end < len(text):
            candidates = [
                text.rfind("\n", start + CHUNK_SIZE_CHARS // 2, hard_end),
                text.rfind(". ", start + CHUNK_SIZE_CHARS // 2, hard_end),
                text.rfind(" ", start + CHUNK_SIZE_CHARS // 2, hard_end),
            ]

            boundary = max(candidates)

            if boundary > start:
                end = boundary + 1

        piece = text[start:end].strip()

        if piece:
            chunks.append(piece)

        if end >= len(text):
            break

        start = max(start + 1, end - CHUNK_OVERLAP_CHARS)

    return chunks


def chunk_extraction_text(text: str):

    chunks = []

    for page_number, page_text in _split_page_blocks(text):
        page_chunks = _split_long_text(page_text)

        chunks.extend((page_number, chunk) for chunk in page_chunks)

    return chunks


def _bm25_scores(query: str, documents: list[str]) -> list[float]:
    """
    BM25 with Vietnamese unigram + bigram features.

    Exact adjacent phrases receive higher weight than
    isolated word matches.
    """

    query_terms = _expanded_query_terms(query)

    if not query_terms or not documents:
        return [0.0] * len(documents)

    tokenized_docs = [_bm25_terms(document) for document in documents]

    doc_count = len(tokenized_docs)

    avg_length = sum(len(doc) for doc in tokenized_docs) / max(doc_count, 1)

    document_frequency = Counter()
    term_frequencies = []

    for tokens in tokenized_docs:
        frequencies = Counter(tokens)
        term_frequencies.append(frequencies)

        document_frequency.update(frequencies.keys())

    k1 = 1.5
    b = 0.75
    phrase_weight = 2.0

    scores = []

    for tokens, frequencies in zip(tokenized_docs, term_frequencies, strict=True):
        doc_length = len(tokens)
        score = 0.0

        for term in query_terms:
            frequency = frequencies.get(term, 0)

            if frequency == 0:
                continue

            df = document_frequency[term]

            inverse_frequency = math.log(1 + ((doc_count - df + 0.5) / (df + 0.5)))

            denominator = frequency + k1 * (1 - b + b * doc_length / max(avg_length, 1))

            term_score = inverse_frequency * frequency * (k1 + 1) / denominator

            # Boost exact adjacent phrase matches.
            if term.startswith("__bi__"):
                term_score *= phrase_weight

            score += term_score

        scores.append(score)

    return scores


def _title_relevance_boost(
    query: str,
    title: str,
    weight: float = 0.25,
) -> float:
    """
    Tăng nhẹ điểm truy xuất khi tiêu đề học liệu
    chứa các từ hoặc cụm từ trong câu hỏi.

    Maximum boost: 25%.
    """

    query_terms = set(_bm25_terms(query))
    title_terms = set(_bm25_terms(title))

    if not query_terms:
        return 1.0

    overlap = len(query_terms.intersection(title_terms))

    coverage = overlap / len(query_terms)

    return 1.0 + weight * coverage


def retrieve_course_chunks(course, question: str, top_k: int = DEFAULT_TOP_K):

    extractions = list(
        MaterialFileExtraction.objects.filter(
            # Extraction phải hoàn thành thành công.
            status=ExtractionStatus.SUCCESS,
            # File phải được quét an toàn.
            stored_file__status=FileStatus.CLEAN,
            # File phải thuộc đúng học phần.
            stored_file__course=course,
            stored_file__purpose=FilePurpose.COURSE_MATERIAL,
            # Chỉ sử dụng phiên bản học liệu đã từng được công bố.
            material_version__is_published=True,
            # Học liệu phải thuộc đúng học phần và không bị ẩn.
            material_version__material__course=course,
            material_version__material__is_hidden=False,
            # Chỉ lấy phiên bản đang được công bố.
            material_version__material__published_version_id=F("material_version_id"),
            # File extraction và file trong manifest phải cùng phiên bản.
            material_file__material_version_id=F("material_version_id"),
            # Đảm bảo extraction trỏ đúng file trong manifest.
            material_file__file_id=F("stored_file_id"),
            # Hash extraction phải khớp manifest.
            file_hash=F("material_file__sha256_hash"),
        )
        # Hash extraction phải đồng thời khớp file lưu trữ.
        .filter(file_hash=F("stored_file__sha256_hash"))
        .exclude(file_hash="")
        .annotate(rag_text=Substr("extracted_text", 1, MAX_DOCUMENT_CHARS))
        .values(
            "id",
            "rag_text",
            "material_version_id",
            "stored_file_id",
            "file_hash",
            "material_version__material__id",
            "material_version__material__title",
            "material_version__material__course__code",
            "material_version__material__course__name",
            "material_file__file_name",
            "stored_file__file_name",
        )
        .order_by("material_version__material__title", "material_file__position", "id")[
            :MAX_EXTRACTIONS_PER_QUERY
        ]
    )

    candidates = []

    for extraction in extractions:
        for page_number, chunk in chunk_extraction_text(extraction["rag_text"] or ""):
            if tokenize(chunk):
                candidates.append((extraction, page_number, chunk))

    if not candidates:
        return []

    # Step 1: Filter irrelevant passages.
    candidates = filter_relevant_candidates(question, candidates)

    if not candidates:
        return []

    # Step 2: Rank relevant passages using BM25.

    scores = _bm25_scores(question, [item[2] for item in candidates])

    # Apply a small title relevance boost.
    adjusted_results = []

    for candidate, score in zip(candidates, scores, strict=True):
        extraction = candidate[0]

        material_title = extraction.get("material_version__material__title") or ""

        boost = _title_relevance_boost(
            question,
            material_title,
        )

        adjusted_score = score * boost

        adjusted_results.append((candidate, adjusted_score))

    ranked = sorted(adjusted_results, key=lambda item: item[1], reverse=True)

    results = []
    seen = set()

    for (extraction, page_number, chunk), score in ranked:
        if score <= 0:
            continue

        material_id = str(extraction["material_version__material__id"])

        material_title = extraction["material_version__material__title"]

        file_name = extraction["material_file__file_name"] or extraction["stored_file__file_name"]

        dedupe_key = (str(extraction["id"]), page_number, chunk[:120])

        if dedupe_key in seen:
            continue

        seen.add(dedupe_key)

        citation_id = f"S{len(results) + 1}"

        results.append(
            RetrievedChunk(
                version_id=str(extraction["material_version_id"]),
                file_id=str(extraction["stored_file_id"]),
                file_hash=extraction["file_hash"],
                citation_id=citation_id,
                material_id=material_id,
                material_title=material_title,
                course_code=extraction["material_version__material__course__code"],
                course_name=extraction["material_version__material__course__name"],
                file_name=file_name,
                page_number=page_number,
                text=chunk,
                score=round(score, 4),
            )
        )

        if len(results) >= max(1, min(top_k, 10)):
            break
    return results
