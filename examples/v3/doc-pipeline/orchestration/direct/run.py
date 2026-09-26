"""Variant A: list the inbox and process each new PDF (run by hand or on a schedule)."""
from processing.process import process_pdf  # noqa: F401 (example only)


def main() -> None:
    print("List new PDFs in the inbox, then call process_pdf for each one.")


if __name__ == "__main__":
    main()
