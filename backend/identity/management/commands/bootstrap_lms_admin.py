from getpass import getpass

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from identity.managers import canonical_email
from identity.models import User
from identity.services.bootstrap import bootstrap_admin
from platform_core.errors import DomainError


class Command(BaseCommand):
    help = "Provision an LMS administrator after independently confirming email ownership."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--display-name", default="")
        parser.add_argument("--confirm-email-ownership", action="store_true")

    def handle(self, *args, **options):
        if not options["confirm_email_ownership"]:
            raise CommandError(
                "Independently verify email ownership, then use --confirm-email-ownership."
            )
        try:
            email = canonical_email(options["email"])
            password = None
            if not User.objects.filter(email=email).exists():
                password = getpass("New administrator password: ")
                if password != getpass("Confirm password: "):
                    raise CommandError("Passwords do not match.")
            user, _ = bootstrap_admin(
                email=email,
                password=password,
                display_name=options["display_name"],
                ownership_confirmed=True,
            )
        except (DomainError, ValidationError) as error:
            raise CommandError(str(error)) from None
        self.stdout.write(self.style.SUCCESS(f"LMS administrator ready: {user.id}"))
