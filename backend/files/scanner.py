import io
import socket
import zipfile
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

EICAR_SIGNATURE = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
PE_MAGIC = b"MZ"
ELF_MAGIC = b"\x7fELF"
MACHO_MAGICS = (
    b"\xfe\xed\xfa\xce",
    b"\xfe\xed\xfa\xcf",
    b"\xce\xfa\xed\xfe",
    b"\xcf\xfa\xed\xfe",
)
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8"
ZIP_MAGICS = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")
PDF_MAGIC = b"%PDF-"


@dataclass
class ScanVerdict:
    is_clean: bool
    threat_name: str | None = None
    details: dict[str, Any] = field(default_factory=dict)
    engine: str = "builtin_signature"


class BaseScannerEngine(ABC):
    name: str = "base"

    @abstractmethod
    def scan(self, content: bytes, filename: str) -> ScanVerdict:
        pass


class BuiltinSignatureScanner(BaseScannerEngine):
    name = "builtin_signature"

    def scan(self, content: bytes, filename: str) -> ScanVerdict:
        # 1. Kiểm tra chữ ký virus mẫu chuẩn EICAR
        if EICAR_SIGNATURE in content:
            return ScanVerdict(
                is_clean=False,
                threat_name="EICAR-Standard-Antivirus-Test-File",
                engine=self.name,
                details={
                    "threat_type": "virus_test_signature",
                    "offset": content.find(EICAR_SIGNATURE),
                },
            )

        # 2. Kiểm tra ngụy trang thực thi nhị phân (Executable Headers)
        if content.startswith(PE_MAGIC):
            return ScanVerdict(
                is_clean=False,
                threat_name="Disguised-Binary-Executable-PE",
                engine=self.name,
                details={
                    "threat_type": "disguised_executable",
                    "signature": "PE/MZ",
                },
            )

        if content.startswith(ELF_MAGIC):
            return ScanVerdict(
                is_clean=False,
                threat_name="Disguised-Binary-Executable-ELF",
                engine=self.name,
                details={
                    "threat_type": "disguised_executable",
                    "signature": "ELF",
                },
            )

        for m in MACHO_MAGICS:
            if content.startswith(m):
                return ScanVerdict(
                    is_clean=False,
                    threat_name="Disguised-Binary-Executable-MachO",
                    engine=self.name,
                    details={
                        "threat_type": "disguised_executable",
                        "signature": "Mach-O",
                    },
                )

        # 3. MIME Sniffing theo phần mở rộng (Magic Bytes matching)
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

        if ext == "pdf":
            if not content.startswith(PDF_MAGIC):
                return ScanVerdict(
                    is_clean=False,
                    threat_name="MIME-Mismatch-Disguised-PDF",
                    engine=self.name,
                    details={
                        "expected_mime": "application/pdf",
                        "reason": "Missing %PDF- magic bytes",
                    },
                )
        elif ext in ["docx", "xlsx", "zip", "pptx"]:
            if not any(content.startswith(magic) for magic in ZIP_MAGICS):
                return ScanVerdict(
                    is_clean=False,
                    threat_name="MIME-Mismatch-Disguised-Archive",
                    engine=self.name,
                    details={
                        "expected_mime": "application/zip",
                        "reason": "Missing PK zip archive magic bytes",
                    },
                )
        elif ext == "png":
            if not content.startswith(PNG_MAGIC):
                return ScanVerdict(
                    is_clean=False,
                    threat_name="MIME-Mismatch-Disguised-PNG",
                    engine=self.name,
                    details={
                        "expected_mime": "image/png",
                        "reason": "Missing PNG header magic bytes",
                    },
                )
        elif ext in ["jpg", "jpeg"]:
            if not content.startswith(JPEG_MAGIC):
                return ScanVerdict(
                    is_clean=False,
                    threat_name="MIME-Mismatch-Disguised-JPEG",
                    engine=self.name,
                    details={
                        "expected_mime": "image/jpeg",
                        "reason": "Missing JPEG header magic bytes",
                    },
                )

        if ext in ("docx", "xlsx", "pptx", "zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(content)) as archive:
                    entries = archive.infolist()
                    names = {entry.filename for entry in entries}
                    invalid = (
                        len(entries) > 1000
                        or sum(entry.file_size for entry in entries) > 100 * 1024 * 1024
                        or any(
                            entry.flag_bits & 1
                            or entry.filename.lower().endswith((".zip", ".7z", ".rar"))
                            or "vbaproject" in entry.filename.lower()
                            for entry in entries
                        )
                    )
                    required = {
                        "docx": "word/document.xml",
                        "xlsx": "xl/workbook.xml",
                        "pptx": "ppt/presentation.xml",
                    }.get(ext)
                    if required and (required not in names or "[Content_Types].xml" not in names):
                        invalid = True
                    if invalid:
                        return ScanVerdict(False, "Unsupported-Archive", engine=self.name)
            except (zipfile.BadZipFile, OSError, ValueError):
                return ScanVerdict(False, "Invalid-Archive", engine=self.name)
        elif ext == "gif" and not content.startswith((b"GIF87a", b"GIF89a")):
            return ScanVerdict(False, "MIME-Mismatch-GIF", engine=self.name)
        elif ext == "webp" and not (content.startswith(b"RIFF") and content[8:12] == b"WEBP"):
            return ScanVerdict(False, "MIME-Mismatch-WEBP", engine=self.name)
        elif ext not in {"pdf", "png", "jpg", "jpeg", "gif", "webp"}:
            return ScanVerdict(False, "Unsupported-Type", engine=self.name)

        # Tệp sạch hợp lệ
        return ScanVerdict(
            is_clean=True,
            engine=self.name,
            details={
                "file_size": len(content),
                "extension": ext,
            },
        )


class ClamAVSocketScanner(BaseScannerEngine):
    name = "clamav_daemon"

    def __init__(self, host: str | None = None, port: int | None = None, timeout: float = 5.0):
        self.host = host or getattr(settings, "CLAMAV_HOST", "127.0.0.1")
        self.port = port or getattr(settings, "CLAMAV_PORT", 3310)
        self.timeout = timeout
        self.fallback_scanner = BuiltinSignatureScanner()

    def scan(self, content: bytes, filename: str) -> ScanVerdict:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(self.timeout)
                s.connect((self.host, self.port))
                # ClamAV INSTREAM protocol
                s.sendall(b"zINSTREAM\0")
                chunk_size = 2048
                for i in range(0, len(content), chunk_size):
                    chunk = content[i : i + chunk_size]
                    s.sendall(len(chunk).to_bytes(4, byteorder="big") + chunk)
                s.sendall(b"\x00\x00\x00\x00")
                raw = b""
                while b"\0" not in raw and len(raw) < 4096:
                    part = s.recv(4096 - len(raw))
                    if not part:
                        break
                    raw += part
                if not raw.endswith(b"\0"):
                    raise OSError("Incomplete scanner response")
                response = raw[:-1].decode("utf-8", errors="strict").strip()

                if response == "stream: OK":
                    # Chạy tiếp MIME sniffing
                    verdict = self.fallback_scanner.scan(content, filename)
                    verdict.engine = self.name
                    return verdict
                if response.startswith("stream: ") and response.endswith(" FOUND"):
                    threat = response.split("FOUND")[0].replace("stream:", "").strip()
                    return ScanVerdict(
                        is_clean=False,
                        threat_name=threat or "ClamAV-Detected-Threat",
                        engine=self.name,
                        details={"clamav_response": response},
                    )
                raise OSError("Scanner rejected the stream")
        except (OSError, TimeoutError, UnicodeError) as error:
            # Never substitute signature-only checks for antivirus availability.
            raise OSError("Antivirus scan unavailable") from error


class MockScanner(BaseScannerEngine):
    name = "mock_scanner"

    def __init__(
        self,
        force_clean: bool = True,
        force_threat: str | None = None,
        force_exception: Exception | None = None,
    ):
        self.force_clean = force_clean
        self.force_threat = force_threat
        self.force_exception = force_exception

    def scan(self, content: bytes, filename: str) -> ScanVerdict:
        if self.force_exception:
            raise self.force_exception
        if self.force_threat or not self.force_clean:
            return ScanVerdict(
                is_clean=False,
                threat_name=self.force_threat or "Mock-Threat",
                engine=self.name,
                details={"mock": True},
            )
        return ScanVerdict(
            is_clean=True,
            engine=self.name,
            details={"mock": True, "file_size": len(content)},
        )


def get_scanner_engine(engine_name: str | None = None) -> BaseScannerEngine:
    engine_name = engine_name or settings.FILES_SCANNER_ENGINE
    if engine_name == "clamav":
        return ClamAVSocketScanner(timeout=15)
    if not settings.FILES_ALLOW_TEST_SCANNERS:
        raise ImproperlyConfigured("Signature/mock scanners are test-only")
    if engine_name == "mock":
        return MockScanner()
    if engine_name == "builtin":
        return BuiltinSignatureScanner()
    raise ImproperlyConfigured("Unsupported scanner")
