import hashlib
from pathlib import Path

import boto3
from django.conf import settings


class LocalFileStorage:
    def __init__(self, base_dir=None):
        self.base_dir = Path(base_dir or settings.MEDIA_ROOT).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key):
        result = (self.base_dir / key).resolve()
        if not result.is_relative_to(self.base_dir) or result == self.base_dir:
            raise ValueError("Invalid object key")
        return result

    def save(self, key, content):
        dest = self._resolve(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            with dest.open("xb") as stream:
                stream.write(content)
        except FileExistsError:
            if dest.read_bytes() != content:
                raise ValueError("Immutable object already exists") from None
        return key

    def read(self, key):
        return self._resolve(key).read_bytes()

    def exists(self, key):
        return self._resolve(key).is_file()

    def size(self, key):
        return self._resolve(key).stat().st_size if self.exists(key) else 0

    def delete(self, key):
        self._resolve(key).unlink(missing_ok=True)
        return True

    def move(self, source, dest):
        self.save(dest, self.read(source))
        self.delete(source)
        return True


class S3FileStorage:
    """Private objects; no public ACL, signed download URL or client-selected key."""

    def __init__(self):
        self.bucket = settings.FILES_S3_BUCKET
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.FILES_S3_ENDPOINT or None,
            region_name=settings.FILES_S3_REGION,
        )

    def save(self, key, content):
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=content,
            IfNoneMatch="*",
            Metadata={"sha256": hashlib.sha256(content).hexdigest()},
        )
        return key

    def read(self, key):
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        with response["Body"] as stream:
            return stream.read(settings.FILES_SYSTEM_MAX_SIZE + 1)

    def exists(self, key):
        from botocore.exceptions import ClientError

        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as error:
            if error.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def size(self, key):
        return self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"]

    def delete(self, key):
        self.client.delete_object(Bucket=self.bucket, Key=key)
        return True

    def move(self, source, dest):
        self.save(dest, self.read(source))
        self.delete(source)
        return True


_default_storage = None
_default_config = None


def get_storage():
    global _default_storage, _default_config
    config = (
        settings.FILES_STORAGE_BACKEND,
        str(settings.MEDIA_ROOT),
        settings.FILES_S3_BUCKET,
        settings.FILES_S3_ENDPOINT,
        settings.FILES_S3_REGION,
    )
    if _default_storage is None or _default_config != config:
        if config[0] == "s3":
            _default_storage = S3FileStorage()
        elif config[0] == "local":
            _default_storage = LocalFileStorage()
        else:
            raise ValueError("Unsupported storage backend")
        _default_config = config
    return _default_storage
