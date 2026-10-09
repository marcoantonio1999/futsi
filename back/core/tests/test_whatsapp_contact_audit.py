from unittest import TestCase
from unittest.mock import MagicMock, patch

from core.services.whatsapp_contact_audit import classification_group, contact_audit


class ContactAuditTests(TestCase):
    def test_groups_preserve_uncertain_and_former_clients(self):
        expected = {
            "Prospecto": "prospect", "Lista de espera": "prospect",
            "Alumno confirmado": "current_client", "Familia / cliente": "current_client",
            "Alumno probable": "ambiguous", "Sin texto": "ambiguous",
            "Sin clasificar": "unclassified", "": "unclassified",
            "Baja confirmada": "other", "No aplica": "other",
            "Fue alumno en 2024": "other",
        }
        for label, group in expected.items():
            with self.subTest(label=label):
                self.assertEqual(classification_group(label), group)

    @patch("core.services.whatsapp_contact_audit.connection")
    @patch("core.services.whatsapp_contact_audit._directory_phone_id", return_value="123")
    def test_totals_include_all_categories_and_deduplicate_channels(self, phone_id, db):
        db.introspection.table_names.return_value = ["whatsapp_contact_datasets", "whatsapp_contact_records"]
        cursor = MagicMock()
        db.cursor.return_value.__enter__.return_value = cursor
        cursor.fetchall.return_value = [
            ("test", "123", "Prospecto", 5), ("test", "123", "Alumno confirmado", 3),
            ("test", "123", "Indeterminado", 2), ("test", "123", "Sin clasificar", 1),
            ("test", "123", "Baja confirmada", 4),
        ]
        result = contact_audit(["meta:123", "whatsapp:+52123"])
        self.assertEqual(result["total"], 15)
        self.assertEqual(sum(result["categories"].values()), 15)
        self.assertEqual(result["categories"]["unclassified"], 1)
        self.assertEqual(result["categories"]["other"], 4)
        self.assertEqual(cursor.execute.call_args.args[1], ["123"])

    @patch("core.services.whatsapp_contact_audit._directory_phone_id", return_value="")
    def test_unmapped_channel_does_not_query_other_datasets(self, phone_id):
        self.assertEqual(contact_audit(["unknown"])["total"], 0)
