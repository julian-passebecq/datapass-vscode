"""The component's own test: run it with `python -m unittest` in this folder."""
import unittest

from process import process_pdf


class ProcessPdfTest(unittest.TestCase):
    def test_one_pdf_gives_one_result(self):
        self.assertEqual(process_pdf("a.pdf"), {"source": "a.pdf", "pages": []})


if __name__ == "__main__":
    unittest.main()
