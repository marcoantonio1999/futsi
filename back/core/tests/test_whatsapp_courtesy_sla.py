from datetime import timedelta
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import User, WhatsAppConversation, WhatsAppMessage, WhatsAppHumanResponseEvent
from core.whatsapp.attention import closing_acknowledgement


@override_settings(ALLOWED_HOSTS=['testserver'], MIGRATION_MODULES={'core': None})
class CourtesyResponseReportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(username='sla-admin',role='admin'))
        self.now = timezone.now()
        self.conversation = WhatsAppConversation.objects.create(contact_phone='+525500001234',
            from_address='whatsapp:+525500001234',to_address='whatsapp:+15550001111',status='active',current_step='faq')

    def message(self, body, minute, direction='inbound', source='unknown', routing='human_only'):
        row = WhatsAppMessage.objects.create(conversation=self.conversation,provider_sid=f'test-{WhatsAppMessage.objects.count()}',
            direction=direction,body=body,response_source=source,routing_decision=routing)
        row.created_at = self.now-timedelta(minutes=minute)
        WhatsAppMessage.objects.filter(pk=row.pk).update(created_at=row.created_at)
        return row

    def event(self, first, reply=None):
        return WhatsAppHumanResponseEvent.objects.create(conversation=self.conversation,first_inbound_message=first,
            first_inbound_at=first.created_at,human_attention_expected=True,responded_at=reply.created_at if reply else None,
            response_message=reply,response_seconds=int((reply.created_at-first.created_at).total_seconds()) if reply else None)

    def report(self):
        response = self.client.get('/api/whatsapp-conversations/weekly-stats/', {'scope':'all','period_days':7,
            'week_start':timezone.localdate().isoformat()})
        self.assertEqual(response.status_code,200,response.data)
        return response.json()

    def test_closing_variants_and_real_requests(self):
        for text in ['Gracias','Muchísimas gracias 🙏','Mil gracias','Graciasss','grax','Gracias por la información',
                     'Perfecto muchas gracias','Gracias y hasta luego','Adiós','Adiosss','Hasta mañana','Nos vemos',
                     'Bye bye','Chao','Gracias, que tengas un buen día','😊','🙏🏽','❤️','[sticker]','[reaction]']:
            with self.subTest(text=text): self.assertTrue(closing_acknowledgement(text))
        for text in ['Hola','Buen día','Gracias, ¿cuánto cuesta?','Gracias pero tengo una duda','Saludos necesito información',
                     'Gracias mi hijo tiene 7 años','Adiós me confirman la inscripción','[audio]','[image]','你好','1234','']:
            with self.subTest(text=text): self.assertFalse(closing_acknowledgement(text))

    def test_real_final_variants_do_not_start_a_new_manual_request(self):
        for text in ['Bueno gracias', 'Vale gracias', 'Entiendo muchas gracias', 'Sí nos vemos', 'Holaaa si muchas gracias', 'Buenas noches muchas gracias']:
            with self.subTest(text=text): self.assertTrue(closing_acknowledgement(text))
        for text in ['Sí', 'Hola', 'Buenas noches', 'Bueno gracias necesito el costo', 'Vale gracias me puedes agendar', 'Sí nos vemos ¿a qué hora?']:
            with self.subTest(text=text): self.assertFalse(closing_acknowledgement(text))
        self.message('Hola me pasas información',60,routing='unclassified')
        self.message('Las clases son los lunes a las cinco',50,'outbound','human_whatsapp')
        self.message('Excelente muchas gracias',40,routing='unclassified')
        self.message('A ti muchas gracias',30,'outbound','human_whatsapp')
        self.message('[sticker]',20,routing='unclassified')
        self.message('Bueno gracias',10,routing='unclassified')
        data=self.report()
        self.assertEqual(data['summary']['answered'],1)
        self.assertEqual(data['summary']['unanswered'],0)

    def test_historical_courtesy_events_are_omitted_without_database_writes(self):
        first = self.message('Muchísimas gracias 🙏',30)
        event = self.event(first)
        data = self.report()
        self.assertEqual(data['summary']['total'],0)
        self.assertEqual(data['summary']['unanswered'],0)
        self.assertEqual(data['longest_waits'],[])
        event.refresh_from_db(); self.assertTrue(event.human_attention_expected)
        self.assertEqual(WhatsAppHumanResponseEvent.objects.count(),1)

    def test_production_courtesy_reply_does_not_open_manual_request(self):
        self.message('A ustedes!!',30,routing='unclassified')
        self.assertEqual(self.report()['summary']['unanswered'],0)
        self.assertTrue(closing_acknowledgement('A ustedes!!'))
        self.assertFalse(closing_acknowledgement('A ustedes, ¿ya quedó el registro?'))

    def test_old_courtesy_then_real_question_uses_actual_request_time(self):
        first = self.message('[sticker]',50)
        event = self.event(first)
        request = self.message('¿Cuál es el precio?',20)
        self.message('🙏',10)
        data = self.report()
        self.assertEqual(data['summary']['unanswered'],1)
        self.assertEqual(data['longest_waits'][0]['first_inbound_at'],request.created_at.isoformat())
        event.refresh_from_db(); self.assertEqual(event.first_inbound_at,first.created_at)

    def test_answered_courtesy_does_not_pollute_averages(self):
        first = self.message('Hasta luego',90)
        reply = self.message('Hasta luego',5,'outbound','human_whatsapp')
        self.event(first,reply)
        self.assertEqual(self.report()['summary']['total'],0)

    def test_rebased_answered_request_uses_real_delay(self):
        first = self.message('Gracias',90)
        self.message('Necesito informes del torneo',30)
        reply = self.message('El torneo inicia mañana',5,'outbound','human_whatsapp')
        self.event(first,reply)
        self.assertEqual(self.report()['summary']['average_response_seconds'],25*60)

    def test_thanks_never_cancels_a_pending_real_question(self):
        first = self.message('Necesito el horario',40)
        self.event(first); self.message('Gracias',5)
        self.assertEqual(self.report()['summary']['unanswered'],1)

    def test_manual_only_recovery_skips_closings_but_keeps_real_request(self):
        self.message('Gracias',50,routing='unclassified')
        self.assertEqual(self.report()['summary']['total'],0)
        request = self.message('Me pueden enviar el horario',20,routing='unclassified')
        self.message('[sticker]',10,routing='unclassified')
        data = self.report()
        self.assertEqual(data['summary']['unanswered'],1)
        self.assertEqual(data['longest_waits'][0]['first_inbound_at'],request.created_at.isoformat())
