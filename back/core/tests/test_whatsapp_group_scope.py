from django.test import TestCase
from core.models import WhatsAppConversation
from core.whatsapp.conversation_scope import individual_conversations


class IndividualConversationScopeTests(TestCase):
    def test_explicit_groups_are_excluded_without_deleting_history(self):
        records = [
            ({}, '+525500000001', 'whatsapp:+525500000001', True),
            ({'contact_name': 'Grupo de familias'}, '+525500000002', 'whatsapp:+525500000002', True),
            ({'is_group': False, 'group_id': None}, '+525500000003', 'whatsapp:+525500000003', True),
            ({'isGroup': False, 'group_id': ''}, '+525500000004', 'whatsapp:+525500000004', True),
            ({'is_group': True}, '+525500000005', 'whatsapp:+525500000005', False),
            ({'isGroup': True}, '+525500000006', 'whatsapp:+525500000006', False),
            ({'chat_type': 'group'}, '+525500000007', 'whatsapp:+525500000007', False),
            ({'chatType': 'GROUP'}, '+525500000008', 'whatsapp:+525500000008', False),
            ({'group_id': '123'}, '+525500000009', 'whatsapp:+525500000009', False),
            ({'groupId': '456'}, '+525500000010', 'whatsapp:+525500000010', False),
            ({}, '123@g.us', 'whatsapp:123@g.us', False),
        ]
        expected=[]
        for context, phone, address, individual in records:
            row=WhatsAppConversation.objects.create(contact_phone=phone, from_address=address,
                to_address='whatsapp:+15550001111', context=context)
            if individual: expected.append(row.pk)
        self.assertCountEqual(individual_conversations(WhatsAppConversation.objects.all()).values_list('pk',flat=True), expected)
        self.assertEqual(WhatsAppConversation.objects.count(),len(records))
