from django.core.management.base import BaseCommand

from identity.services.passwords import cleanup_expired_auth_data


class Command(BaseCommand):
    help = "Purge stale rate-limit buckets and expired/used password reset tokens."

    def handle(self, *args, **options):
        result = cleanup_expired_auth_data()
        self.stdout.write(
            self.style.SUCCESS(
                f"Successfully cleaned up auth data: "
                f"{result['buckets_deleted']} rate-limit bucket(s) deleted, "
                f"{result['tokens_deleted']} reset token(s) deleted, "
                f"{result.get('verification_tokens_deleted', 0)} verification token(s) deleted."
            )
        )
