import time

from django.core.management.base import BaseCommand

from identity.transport import dispatch_pending_auth_emails


class Command(BaseCommand):
    help = (
        "Dispatch pending and recoverable authentication emails "
        "(password reset and email verification)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--batch-size",
            type=int,
            default=50,
            help="Maximum number of deliveries of each type to process per batch (default 50).",
        )
        parser.add_argument(
            "--daemon",
            action="store_true",
            help="Run continuously in background polling for pending emails.",
        )
        parser.add_argument(
            "--poll-interval",
            type=float,
            default=2.0,
            help="Seconds to sleep between polls in daemon mode (default 2.0).",
        )
        parser.add_argument(
            "--max-iterations",
            type=int,
            default=None,
            help="Maximum loop iterations in daemon mode (default unlimited).",
        )

    def handle(self, *args, **options):
        batch_size = options.get("batch_size", 50)
        is_daemon = options.get("daemon", False)
        poll_interval = options.get("poll_interval", 2.0)
        max_iterations = options.get("max_iterations")

        iteration = 0
        while True:
            iteration += 1
            results = dispatch_pending_auth_emails(max_batch=batch_size)
            pwd_sent = sum(1 for d in results["password_reset"] if d.status == "sent")
            pwd_failed = sum(1 for d in results["password_reset"] if d.status == "failed")
            pwd_pending = sum(1 for d in results["password_reset"] if d.status == "pending")

            verif_sent = sum(1 for d in results["email_verification"] if d.status == "sent")
            verif_failed = sum(1 for d in results["email_verification"] if d.status == "failed")
            verif_pending = sum(1 for d in results["email_verification"] if d.status == "pending")

            total_processed = len(results["password_reset"]) + len(results["email_verification"])
            if total_processed > 0 or not is_daemon:
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Processed {total_processed} delivery attempt(s): "
                        f"password_reset ({pwd_sent} sent, {pwd_pending} pending, "
                        f"{pwd_failed} failed), "
                        f"email_verification ({verif_sent} sent, {verif_pending} pending, "
                        f"{verif_failed} failed)."
                    )
                )

            if not is_daemon:
                break

            if max_iterations is not None and iteration >= max_iterations:
                break

            time.sleep(poll_interval)
