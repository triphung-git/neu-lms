import csv

from django.http import HttpResponse


def csv_text(value):
    text = str(value)
    if text.startswith(("\t", "\r", "\n")) or text.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


def gradebook_csv_response(course, assignment, rows):
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="bang-diem-{assignment.pk}.csv"'
    response["Cache-Control"] = "private, no-store"
    response.write("\ufeff")  # Giúp Excel nhận đúng tiếng Việt.

    writer = csv.writer(response)
    writer.writerow(
        [
            "Môn học",
            "Bài tập",
            "Sinh viên",
            "Email",
            "Lần nộp",
            "Thang điểm",
            "Trạng thái chấm",
            "Điểm bản mới nhất",
            "Điểm đã công bố",
        ]
    )

    total_score = assignment.total_score

    for row in rows:
        latest = row["latest_grade"]
        published = row["published_grade"]

        state = "Chưa nộp" if row["revision_number"] is None else "Chưa chấm"
        if latest is not None:
            state = latest.get_status_display()

        writer.writerow(
            [
                csv_text(course.name),
                csv_text(assignment.title),
                csv_text(row["name"]),
                csv_text(row["email"]),
                row["revision_number"],
                total_score,
                state,
                latest.score if latest is not None else None,
                published.score if published is not None else None,
            ]
        )

    return response
