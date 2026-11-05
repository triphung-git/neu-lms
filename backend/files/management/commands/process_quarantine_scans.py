from django.core.management.base import BaseCommand

from files.models import FileStatus, StoredFile
from files.scanner import get_scanner_engine
from files.services import scan_stored_file


class Command(BaseCommand):
    help = "Process files pending virus and integrity scanning in quarantine"

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=50,
            help="Maximum number of files to scan in this run",
        )
        parser.add_argument(
            "--engine",
            type=str,
            default="clamav",
            choices=["builtin", "clamav", "mock"],
            help="Scanner engine to use",
        )

    def handle(self, *args, **options):
        limit = options["limit"]
        engine_name = options["engine"]
        scanner = get_scanner_engine(engine_name)

        pending_files = list(
            StoredFile.objects.filter(status=FileStatus.SCANNING)
            .order_by("created_at")[:limit]
            .values_list("id", flat=True)
        )

        self.stdout.write(f"Found {len(pending_files)} files in SCANNING state.")

        clean_count = 0
        infected_count = 0
        error_count = 0

        for file_id in pending_files:
            try:
                res = scan_stored_file(file_id=file_id, scanner=scanner)
                if res.status == FileStatus.CLEAN:
                    clean_count += 1
                elif res.status == FileStatus.INFECTED:
                    infected_count += 1
            except Exception as e:
                error_count += 1
                self.stderr.write(f"Error scanning file {file_id}: {e}")

        self.stdout.write(
            self.style.SUCCESS(
                f"Scan batch finished: {len(pending_files)} processed "
                f"({clean_count} clean, {infected_count} infected, {error_count} errors)."
            )
        )
