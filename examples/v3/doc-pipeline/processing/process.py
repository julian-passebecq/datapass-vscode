"""Shared by every variant: read one PDF, write one JSON result."""


def process_pdf(name: str) -> dict:
    return {"source": name, "pages": []}
