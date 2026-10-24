from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class StandardPageNumberPagination(PageNumberPagination):
    """
    Standard pagination for NEU LMS APIs.
    Enforces page bounds, max page size (100), and uniform envelope:
    {
        "items": [...],
        "pagination": {
            "page": int,
            "page_size": int,
            "total_items": int,
            "total_pages": int,
            "has_next": bool,
            "has_previous": bool
        }
    }
    """

    page_query_param = "page"
    page_size_query_param = "page_size"
    page_size = 20
    max_page_size = 100

    def paginate_queryset(self, queryset, request, view=None):
        page_param = request.query_params.get(self.page_query_param)
        if page_param is not None:
            try:
                page_num = int(page_param)
                if page_num < 1:
                    raise ValidationError(
                        {
                            self.page_query_param: [
                                "Số trang phải là số nguyên dương lớn hơn hoặc bằng 1."
                            ]
                        }
                    )
            except ValueError as err:
                raise ValidationError(
                    {self.page_query_param: ["Số trang phải là một số nguyên hợp lệ."]}
                ) from err

        page_size_param = request.query_params.get(self.page_size_query_param)
        if page_size_param is not None:
            try:
                size_num = int(page_size_param)
                if size_num < 1:
                    raise ValidationError(
                        {
                            self.page_size_query_param: [
                                "Kích thước trang phải là số nguyên dương lớn hơn hoặc bằng 1."
                            ]
                        }
                    )
            except ValueError as err:
                raise ValidationError(
                    {self.page_size_query_param: ["Kích thước trang phải là một số nguyên hợp lệ."]}
                ) from err

        # Ensure stable ordering on Django querysets to avoid inconsistent pagination slices
        if hasattr(queryset, "ordered") and not queryset.ordered:
            queryset = queryset.order_by("pk")

        return super().paginate_queryset(queryset, request, view=view)

    def get_paginated_response(self, data):
        return Response(
            {
                "items": data,
                "pagination": {
                    "page": self.page.number,
                    "page_size": self.get_page_size(self.request),
                    "total_items": self.page.paginator.count,
                    "total_pages": self.page.paginator.num_pages,
                    "has_next": self.page.has_next(),
                    "has_previous": self.page.has_previous(),
                },
            }
        )

    def get_paginated_response_schema(self, schema):
        return {
            "type": "object",
            "required": ["items", "pagination"],
            "properties": {
                "items": schema,
                "pagination": {
                    "type": "object",
                    "required": [
                        "page",
                        "page_size",
                        "total_items",
                        "total_pages",
                        "has_next",
                        "has_previous",
                    ],
                    "properties": {
                        "page": {"type": "integer", "example": 1},
                        "page_size": {"type": "integer", "example": 20},
                        "total_items": {"type": "integer", "example": 100},
                        "total_pages": {"type": "integer", "example": 5},
                        "has_next": {"type": "boolean", "example": True},
                        "has_previous": {"type": "boolean", "example": False},
                    },
                },
            },
        }
