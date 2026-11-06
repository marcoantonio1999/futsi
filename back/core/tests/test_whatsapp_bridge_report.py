from datetime import datetime, timezone
import pytest
from unittest.mock import patch
from datetime import timedelta
from django.conf import settings
from django.db import connection
from core.models import WhatsAppConversation
from core.services.whatsapp_quality_report import QualityAudit
from core.services.whatsapp_bridge_report import bridge_report, RUBRIC
pytestmark = pytest.mark.django_db(transaction=True)

def test_bridge_report_limits_findings_to_authorized_conversations(auth_client):
    assert settings.FUTSI_ENV == 'test' and connection.vendor == 'sqlite'
    created = QualityAudit._meta.db_table not in connection.introspection.table_names()
    if created:
        with connection.schema_editor() as editor: editor.create_model(QualityAudit)
    try:
        from django.utils import timezone as django_timezone
        cutoff = django_timezone.now() - timedelta(days=1)
        first = WhatsAppConversation.objects.create(to_address='meta:1', contact_phone='+15550000001', from_address='whatsapp:+15550000001')
        second = WhatsAppConversation.objects.create(to_address='meta:2', contact_phone='+15550000002', from_address='whatsapp:+15550000002')
        for chat in (first, second):
            QualityAudit.objects.create(conversation_id=chat.pk, channel=chat.to_address, period_end=cutoff, rubric=RUBRIC, status='completed', model='luna', usage={}, result={'category':'missed_opportunity', 'evidence_message_ids':[1,2]})
        output = bridge_report(WhatsAppConversation.objects.filter(pk=first.pk), cutoff)
        assert output['counts'] == {'missed_opportunity': 1}
        assert [item['conversation_id'] for item in output['findings']] == [first.pk]
        client, _, _ = auth_client(role='admin')
        response = client.get('/api/whatsapp-conversations/bridge-audit/', {'scope': 'all'})
        assert response.status_code == 200
        assert response['Cache-Control'] == 'private, no-store'
        assert response.json()['counts'] == {'missed_opportunity': 2}
        with patch('core.api.whatsapp_notifications.attention_notifications', return_value={'items': [], 'total': 0}):
            notices = client.get('/api/whatsapp-conversations/attention-notifications/').json()
        assert notices['total'] == 2
        assert all(item['kind'] == 'bridge' for item in notices['items'])
    finally:
        QualityAudit.objects.all().delete()
        if created:
            with connection.schema_editor() as editor: editor.delete_model(QualityAudit)
