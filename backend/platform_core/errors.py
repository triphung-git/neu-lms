class DomainError(Exception):
    """Stable internal error code. HTTP mapping belongs to B01c."""

    def __init__(self, code):
        self.code = code
        super().__init__(code)
