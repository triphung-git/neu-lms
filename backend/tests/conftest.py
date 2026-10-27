import pytest


@pytest.fixture(autouse=True)
def isolate_private_file_storage(request, settings, tmp_path):
    if request.node.path.name.startswith("test_file"):
        settings.MEDIA_ROOT = str(tmp_path / "private-files")
        settings.FILES_STORAGE_BACKEND = "local"
        settings.FILES_SCANNER_ENGINE = "builtin"
        settings.FILES_ALLOW_TEST_SCANNERS = True
