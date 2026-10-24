from django.core.management.base import BaseCommand

from identity.transport import retry_pending_reset_deliveries


class Command(BaseCommand):
    help = "Retry pending and unexpired password reset email deliveries."

    def add_arguments(self, parser):
        parser.add_argument(
            "--batch-size",
            type=int,
            default=50,
            help="Maximum number of deliveries to retry in a single run (default 50).",
        )

    def handle(self, *args, **options):
        batch_size = options.get("batch_size", 50)
        retried = retry_pending_reset_deliveries(max_batch=batch_size)
        sent_count = sum(1 for d in retried if d.status == "sent")
        failed_count = sum(1 for d in retried if d.status == "failed")
        pending_count = sum(1 for d in retried if d.status == "pending")

        self.stdout.write(
            self.style.SUCCESS(
                f"Processed {len(retried)} delivery retry attempt(s): "
                f"{sent_count} sent, {pending_count} still pending, {failed_count} failed."
            )
        )
