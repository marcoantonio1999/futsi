from datetime import timedelta
from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import User, WhatsAppConversation, WhatsAppMessage, WhatsAppHumanResponseEvent
from core.services.whatsapp_quality_report import QualityAudit
from core.services.whatsapp_attention_audit import message_version, ignored_request_ids


@override_settings(ALLOWED_HOSTS=['testserver'], MIGRATION_MODULES={'core':None}, FUTSI_ENV='test')
class AttentionAuditReadTests(TransactionTestCase):
    def setUp(self):
        with connection.schema_editor() as editor: editor.create_model(QualityAudit)
        self.client=APIClient(); self.client.force_authenticate(User.objects.create_user(username='closure-admin',role='admin'))
        self.now=timezone.now()
        self.chat=WhatsAppConversation.objects.create(to_address='meta:123456789',from_address='whatsapp:+525500000001',contact_phone='+525500000001')

    def tearDown(self):
        with connection.schema_editor() as editor: editor.delete_model(QualityAudit)

    def message(self,text,minute=10,direction='inbound',source='unknown'):
        m=WhatsAppMessage.objects.create(conversation=self.chat,body=text,direction=direction,response_source=source,provider_sid=f'closure-{WhatsAppMessage.objects.count()}')
        m.created_at=self.now-timedelta(minutes=minute)
        WhatsAppMessage.objects.filter(pk=m.pk).update(created_at=m.created_at)
        return m

    def audit(self,messages,ignored,state='closed'):
        return QualityAudit.objects.create(conversation_id=self.chat.pk,channel=self.chat.to_address,
            rubric='attention_v2',status='completed',model='gpt-6-luna',period_end=self.now-timedelta(minutes=1),usage={},
            result={'confidence':.98,'current_state':state,'non_request_ids':[m.pk for m in ignored],
            'resolved_request_ids':[],'last_message_id':messages[-1].pk,'human_last_reply_at':'',
            'analyzed_until':self.now.isoformat(),'message_versions':{str(m.pk):message_version(dict(id=m.pk,
            body=m.body,created_at=m.created_at,direction=m.direction,response_source=m.response_source)) for m in messages}})

    def report(self):
        response=self.client.get('/api/whatsapp-conversations/weekly-stats/',{'scope':'all','range':'week'})
        self.assertEqual(response.status_code,200,response.content)
        return response.json()

    def test_si_nos_vemos_not_unanswered_and_no_fabricated_reply(self):
        reply=self.message('Te esperamos mañana a las cinco',30,'outbound','human_whatsapp')
        close=self.message('Sí, nos vemos')
        event=WhatsAppHumanResponseEvent.objects.create(conversation=self.chat,first_inbound_message=close,first_inbound_at=close.created_at)
        self.audit([reply,close],[close])
        self.assertEqual(self.report()['summary']['unanswered'],0)
        event.refresh_from_db(); self.assertIsNone(event.responded_at); self.assertTrue(event.human_attention_expected)
        response=self.client.get(f'/api/whatsapp-conversations/{self.chat.pk}/?scope=all')
        self.assertEqual(response.status_code,200,response.content)
        self.assertEqual(response.json()['attention_analysis']['current_state'],'closed')
        self.assertEqual(response.json()['attention_not_required_ids'],[close.pk])

    def test_manual_recovery_skips_only_verified_message_not_whole_chat(self):
        close=self.message('Sí, nos vemos',30); close.routing_decision='unclassified'; close.save()
        self.audit([close],[close]); self.assertEqual(self.report()['summary']['unanswered'],0)
        question=self.message('¿Cuál es el precio?',5); question.routing_decision='unclassified'; question.save()
        self.assertEqual(self.report()['summary']['unanswered'],1)
        response=self.client.get(f'/api/whatsapp-conversations/{self.chat.pk}/?scope=all')
        self.assertIsNone(response.json()['attention_analysis'])
        self.assertEqual(response.json()['attention_not_required_ids'],[close.pk])

    def test_thanks_does_not_remove_old_unanswered_question(self):
        question=self.message('Necesito el horario',40)
        close=self.message('Le agradezco muchísimo la atención',10)
        WhatsAppHumanResponseEvent.objects.create(conversation=self.chat,first_inbound_message=question,first_inbound_at=question.created_at)
        self.audit([question,close],[close],state='pending')
        self.assertEqual(self.report()['summary']['unanswered'],1)

    def test_edited_evidence_or_human_echo_invalidates_current_snapshot(self):
        close=self.message('Sí, nos vemos'); self.audit([close],[close])
        close.body='Sí, nos vemos, ¿a qué hora?'; close.save()
        self.assertEqual(self.report()['summary']['unanswered'],1)
        self.assertEqual(ignored_request_ids([self.chat.pk],self.now-timedelta(days=7),self.now),set())
        response=self.client.get(f'/api/whatsapp-conversations/{self.chat.pk}/?scope=all')
        self.assertIsNone(response.json()['attention_analysis'])

    def test_confidence_and_cross_chat_ids_cannot_hide_a_request(self):
        close=self.message('Sí, nos vemos'); row=self.audit([close],[close])
        row.result['confidence']=.3; row.save()
        self.assertEqual(ignored_request_ids([self.chat.pk],self.now-timedelta(days=7),self.now),set())
        row.result['confidence']=.99; row.conversation_id=999999; row.save()
        self.assertEqual(ignored_request_ids([self.chat.pk],self.now-timedelta(days=7),self.now),set())

    def test_human_reply_metadata_change_invalidates_snapshot(self):
        close=self.message('Sí, nos vemos'); self.audit([close],[close])
        self.chat.context={'human_last_reply_at':self.now.isoformat()}; self.chat.save()
        response=self.client.get(f'/api/whatsapp-conversations/{self.chat.pk}/?scope=all')
        self.assertIsNone(response.json()['attention_analysis'])
