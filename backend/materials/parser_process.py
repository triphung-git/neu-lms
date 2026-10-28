"""Disposable parser process. No application credentials or database access are needed."""

import json
import sys
from pathlib import Path


def main():
    if sys.platform != "win32":
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
        resource.setrlimit(resource.RLIMIT_FSIZE, (32 * 1024 * 1024,) * 2)
    from .extraction import extract_file_content

    result = extract_file_content(Path(sys.argv[1]).read_bytes(), sys.argv[3], sys.argv[4])
    Path(sys.argv[2]).write_text(json.dumps(result.to_dict()), encoding="utf-8")


if __name__ == "__main__":
    main()
