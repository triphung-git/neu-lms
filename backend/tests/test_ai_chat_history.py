import json
from unittest.mock import patch

from django.test import override_settings

from ai_assistant.llm import generate_course_answer


class MockProviderResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self):
        return json.dumps(
            {"choices": [{"message": {"content": "Theo học liệu, câu trả lời là [S1]."}}]}
        ).encode("utf-8")


@override_settings(
    AI_API_KEY="test-gemini-key",
    AI_CHAT_MODEL="gemini-test-model",
    AI_API_BASE_URL="https://example.test/v1",
    AI_REQUEST_TIMEOUT_SECONDS=5,
)
def test_generate_course_answer_passes_recent_history_as_context_only():
    chunk = type(
        "Chunk",
        (),
        {
            "citation_id": "S1",
            "material_title": "Giáo trình WEB101",
            "file_name": "web101.pdf",
            "page_number": 4,
            "text": "HTTP là giao thức truyền tải siêu văn bản.",
        },
    )()
    history = [
        {"role": "user", "content": "HTTP là gì?"},
        {"role": "assistant", "content": "Mình tìm thấy định nghĩa trong tài liệu."},
    ]
    captured = {}

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["timeout"] = timeout
        captured["payload"] = json.loads(request.data.decode("utf-8"))
        return MockProviderResponse()

    with patch("ai_assistant.llm.urlopen", side_effect=fake_urlopen):
        answer = generate_course_answer(
            "Giải thích thêm giao thức này.",
            [chunk],
            history=history,
        )

    assert answer == "Theo học liệu, câu trả lời là [S1]."
    assert captured["url"] == "https://example.test/v1/chat/completions"
    assert captured["timeout"] == 5
    messages = captured["payload"]["messages"]
    assert messages[0]["role"] == "system"
    assert messages[1:] == [
        {"role": "user", "content": "HTTP là gì?"},
        {"role": "assistant", "content": "Mình tìm thấy định nghĩa trong tài liệu."},
        {
            "role": "user",
            "content": (
                "CÂU HỎI:\nGiải thích thêm giao thức này.\n\n"
                "NGỮ CẢNH NGUỒN:\n[S1] Học liệu: Giáo trình WEB101; "
                "tệp: web101.pdf, trang 4\nHTTP là giao thức truyền tải siêu văn bản."
            ),
        },
    ]
