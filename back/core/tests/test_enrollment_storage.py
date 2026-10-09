from io import BytesIO
from unittest import TestCase
from unittest.mock import patch
from core.services import enrollment_storage
from urllib.error import HTTPError


class EnrollmentStorageTests(TestCase):
    def test_supabase_missing_bucket_400_is_created_private(self):
        missing = HTTPError("https://example.invalid/bucket", 400, "Bad Request", {}, BytesIO(b'{"message":"Bucket not found"}'))
        with patch("core.services.enrollment_storage.storage_headers", return_value={}), patch("core.services.enrollment_storage.urlopen", side_effect=[missing, BytesIO(b'{}')]) as request:
            enrollment_storage.ensure_private_bucket()
            payload = request.call_args[0][0].data
            self.assertIn(b'"public": false', payload)

    def test_public_bucket_is_rejected(self):
        with patch("core.services.enrollment_storage.storage_headers", return_value={}), patch("core.services.enrollment_storage.urlopen", return_value=BytesIO(b'{"public":true}')):
            with self.assertRaises(RuntimeError):
                enrollment_storage.ensure_private_bucket()

    def test_hash_mismatch_is_rejected(self):
        with patch("core.services.enrollment_storage.read_document", return_value=b"changed"):
            with self.assertRaises(RuntimeError):
                enrollment_storage.verify_document("path", "not-the-hash")
