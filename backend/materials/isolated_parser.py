import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from .extraction import MAX_EXTRACTION_TIME_SECONDS, MAX_FILE_SIZE_BYTES, ExtractionResult
from .statuses import ExtractionStatus


def extract_file_isolated(content: bytes, filename: str, mime: str) -> ExtractionResult:
    if len(content) > MAX_FILE_SIZE_BYTES:
        return ExtractionResult(status=ExtractionStatus.FAILED, error_message="File too large")
    with tempfile.TemporaryDirectory(prefix="neu-material-parser-") as directory:
        source, output = Path(directory) / "input", Path(directory) / "result.json"
        source.write_bytes(content)
        env = {
            key: os.environ[key]
            for key in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP")
            if key in os.environ
        }
        env.update(PYTHONPATH=str(Path(__file__).resolve().parent.parent), PYTHONUTF8="1")
        try:
            subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "materials.parser_process",
                    str(source),
                    str(output),
                    filename,
                    mime,
                ],
                cwd=directory,
                env=env,
                check=True,
                timeout=MAX_EXTRACTION_TIME_SECONDS,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if output.stat().st_size > 32 * 1024 * 1024:
                raise ValueError("Output too large")
            result = ExtractionResult(**json.loads(output.read_text(encoding="utf-8")))
            if result.status not in ExtractionStatus.values:
                raise ValueError("Invalid parser status")
            return result
        except (subprocess.SubprocessError, OSError, ValueError, TypeError):
            return ExtractionResult(
                status=ExtractionStatus.FAILED,
                error_message="Parser failed or exceeded resource limits",
            )
