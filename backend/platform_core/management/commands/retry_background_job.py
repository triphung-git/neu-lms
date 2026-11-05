from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from ai_assistant.models import EmbeddingIndexState
from platform_core.models import NotificationEmailDelivery


class Command(BaseCommand):
    help = "Reset one failed job after fixing its configuration. Does not send directly."

    def add_arguments(self, parser):
        parser.add_argument("kind", choices=["index", "email"])
        parser.add_argument("id", type=int)

    def handle(self, *args, **options):
        if options["kind"] == "email":
            changed = NotificationEmailDelivery.objects.filter(
                pk=options["id"], status="failed"
            ).update(
                status="pending",
                attempts=0,
                available_at=timezone.now(),
                locked_at=None,
                last_error_code="",
            )
        else:
            changed = EmbeddingIndexState.objects.filter(pk=options["id"], status="failed").update(
                status="pending", attempts=0, retry_at=None, last_error_code=""
            )
        if not changed:
            raise CommandError("Failed job not found; no changes made.")
        self.stdout.write(self.style.SUCCESS("Queued for the next scheduler cycle."))
