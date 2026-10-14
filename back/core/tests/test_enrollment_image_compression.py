from io import BytesIO
from unittest import TestCase
from PIL import Image
from core.services.enrollment_images import PHOTO_MAX_BYTES, compress_document_photo


class EnrollmentImageCompressionTests(TestCase):
    def test_small_image_bytes_are_preserved(self):
        content = b'small-photo'
        self.assertIs(compress_document_photo(content), content)

    def test_large_document_is_readable_jpeg_under_three_mb(self):
        original = Image.effect_noise((2600, 2000), 100).convert('RGB')
        output = BytesIO()
        original.save(output, 'PNG')
        content = output.getvalue()
        self.assertGreater(len(content), PHOTO_MAX_BYTES)
        compressed = compress_document_photo(content)
        self.assertLessEqual(len(compressed), PHOTO_MAX_BYTES)
        with Image.open(BytesIO(compressed)) as restored:
            self.assertEqual(restored.format, 'JPEG')
            self.assertGreaterEqual(restored.width, 2000)
            restored.verify()
