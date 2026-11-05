from django.db.models import Exists, OuterRef

from .models import SubmissionGradeEntry, SubmissionRevision


def latest_revisions_with_publication():
    newer = SubmissionRevision.objects.filter(
        assignment_id=OuterRef("assignment_id"),
        student_id=OuterRef("student_id"),
        number__gt=OuterRef("number"),
    )

    published = SubmissionGradeEntry.objects.filter(
        submission_id=OuterRef("pk"),
        status=SubmissionGradeEntry.Status.PUBLISHED,
    )

    return SubmissionRevision.objects.filter(~Exists(newer)).alias(
        has_publication=Exists(published),
    )
