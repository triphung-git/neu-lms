from django.contrib.auth.base_user import BaseUserManager
from django.core.exceptions import ValidationError
from django.core.validators import validate_email


def canonical_email(value):
    if not isinstance(value, str):
        raise ValidationError("Invalid email address.")
    value = value.strip().lower()
    if len(value) > 254:
        raise ValidationError("Invalid email address.")
    validate_email(value)
    return value


class UserManager(BaseUserManager):
    use_in_migrations = True

    def get_by_natural_key(self, username):
        return self.get(email=canonical_email(username))

    def create_user(self, email, password=None, **extra_fields):
        # A manager creates no LMS grants. Audited workflows use accounts.create_account.
        user = self.model(email=canonical_email(email), **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, *args, **kwargs):
        raise ValueError("Use bootstrap_lms_admin; LMS roles are not Django superuser flags.")
