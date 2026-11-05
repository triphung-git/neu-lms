from __future__ import annotations

import json
import logging
import math
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings

logger = logging.getLogger(__name__)


class EmbeddingError(Exception):
    """Lỗi khi tạo hoặc xử lý vector embeddings."""


def prepare_query_input(query: str) -> str:
    """
    Format câu hỏi theo hướng Question Answering Retrieval.
    """

    query = query.strip()

    if not query:
        raise ValueError("Query không được để trống.")

    return f"task: question answering | query: {query}"


def prepare_document_input(
    text: str,
    title: str | None = None,
) -> str:
    """
    Format nội dung tài liệu theo cấu trúc title/text.
    """

    text = text.strip()
    title = (title or "none").strip()

    if not text:
        raise ValueError("Document không được để trống.")

    return f"title: {title} | text: {text}"


def cosine_similarity(
    vector_a: list[float],
    vector_b: list[float],
) -> float:
    """Tính cosine similarity giữa hai vector."""

    if len(vector_a) != len(vector_b):
        raise ValueError("Hai vector phải có cùng kích thước.")

    if not vector_a:
        return 0.0

    dot_product = sum(a * b for a, b in zip(vector_a, vector_b, strict=True))

    norm_a = math.sqrt(sum(a * a for a in vector_a))
    norm_b = math.sqrt(sum(b * b for b in vector_b))

    if norm_a == 0 or norm_b == 0:
        return 0.0

    return dot_product / (norm_a * norm_b)


def embed_text(
    text: str,
    *,
    is_query: bool = False,
    title: str | None = None,
) -> list[float]:
    """
    Gọi Gemini Embedding 2 và trả về vector 768 chiều.
    """

    api_key = getattr(settings, "AI_API_KEY", "").strip()

    model = getattr(
        settings,
        "AI_EMBEDDING_MODEL",
        "gemini-embedding-2",
    ).strip()

    dimensions = getattr(
        settings,
        "AI_EMBEDDING_DIMENSIONS",
        768,
    )

    timeout = getattr(
        settings,
        "AI_EMBEDDING_TIMEOUT_SECONDS",
        45,
    )

    if not api_key:
        raise EmbeddingError("Chưa cấu hình AI_API_KEY.")

    if is_query:
        formatted_text = prepare_query_input(text)
    else:
        formatted_text = prepare_document_input(text, title)

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent"

    payload = {
        "model": f"models/{model}",
        "content": {
            "parts": [
                {
                    "text": formatted_text,
                }
            ]
        },
        "output_dimensionality": dimensions,
    }

    request = Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))

    except HTTPError as exc:
        logger.warning(
            "Gemini embedding HTTP error: status=%s",
            exc.code,
        )
        raise EmbeddingError(f"Gemini Embedding API trả về HTTP {exc.code}.") from exc

    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        logger.warning(
            "Gemini embedding request failed: %s",
            type(exc).__name__,
        )
        raise EmbeddingError("Không thể kết nối Gemini Embedding API.") from exc

    try:
        values = result["embedding"]["values"]

        vector = [float(value) for value in values]

    except (KeyError, TypeError, ValueError) as exc:
        raise EmbeddingError("Gemini trả về dữ liệu embedding không hợp lệ.") from exc

    if len(vector) != dimensions:
        raise EmbeddingError(f"Vector có {len(vector)} chiều, yêu cầu {dimensions} chiều.")

    if not all(math.isfinite(value) for value in vector):
        raise EmbeddingError("Vector chứa giá trị không hợp lệ.")

    norm = math.sqrt(sum(value * value for value in vector))

    if norm == 0:
        raise EmbeddingError("Gemini trả về vector rỗng.")

    return [value / norm for value in vector]
