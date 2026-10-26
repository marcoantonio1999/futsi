import os
from io import BytesIO
from hashlib import sha256
from unittest.mock import patch
from urllib.parse import urlparse, parse_qs
from PIL import Image, ImageDraw
from django.test import TestCase, override_settings
from django.core import signing
from django.utils import timezone
from datetime import timedelta
from core.tests import test_player_enrollments as fixtures
image_file = fixtures.image_file
from core.enrollment_models import PlayerEnrollment, PlayerEnrollmentDocument
from core.services import enrollment_r2, enrollment_storage
from core.api.enrollments import UPLOAD_SALT

ENV = {'ENROLLMENT_STORAGE_PROVIDER':'r2','ENROLLMENT_R2_ACCOUNT_ID':'a'*32,'ENROLLMENT_R2_BUCKET':'private-test',
       'ENROLLMENT_R2_ACCESS_KEY_ID':'b'*32,'ENROLLMENT_R2_SECRET_ACCESS_KEY':'c'*64}

@override_settings(ALLOWED_HOSTS=['testserver'], MIGRATION_MODULES={'core': None})
class EnrollmentR2Tests(TestCase):
    new_invitation = fixtures.PlayerEnrollmentTests.new_invitation
    payload = fixtures.PlayerEnrollmentTests.payload
    new_withdrawal = fixtures.PlayerEnrollmentTests.new_withdrawal

    def setUp(self):
        fixtures.PlayerEnrollmentTests.setUp(self)
        self.env = patch.dict(os.environ, ENV); self.env.start(); self.addCleanup(self.env.stop)
        self.objects = {}
        def read(path, *args, **kwargs):
            if path not in self.objects: raise RuntimeError('Missing synthetic object')
            return self.objects[path]
        self.read = patch('core.services.enrollment_r2.request', side_effect=read).start()
        def copy(source, destination, mime): self.objects[destination] = self.objects[source]
        self.copy = patch('core.services.enrollment_r2.copy', side_effect=copy).start()
        self.delete = patch('core.services.enrollment_r2.delete', side_effect=lambda path: self.objects.pop(path,None)).start()

    def metadata(self, minor=False):
        data = self.payload(minor=minor)
        if minor:
            del data['player_signature']
        image = Image.new('RGB',(1200,1200),'white'); ImageDraw.Draw(image).line((30,30,900,900),fill='black',width=10)
        buffer = BytesIO(); image.save(buffer,'JPEG')
        files = {}
        for key in list(data):
            if hasattr(data[key], 'read'):
                content = buffer.getvalue() if key=='player_photo' else data[key].read()
                files[key] = {'content': content, 'mime':'image/jpeg' if key=='player_photo' else 'image/png'}
                del data[key]
        return data, files

    def plan(self, files, invitation=None, purpose='enroll'):
        invitation = invitation or self.invitation
        path = 'public' if purpose=='enroll' else 'withdrawal'
        result = self.client.post(f'/api/player-enrollments/{path}/{invitation.token}/uploads/', {'files':[
            {'kind':kind,'mime':f['mime'],'size':len(f['content']),'sha256':sha256(f['content']).hexdigest()} for kind,f in files.items()]}, format='json')
        self.assertEqual(result.status_code,200,result.data)
        receipts = []
        for item in result.data['files']:
            claim = signing.loads(item['receipt'],salt=UPLOAD_SALT)
            self.objects[claim['path']] = files[item['kind']]['content']
            self.assertEqual(item['headers']['If-None-Match'],'*')
            self.assertIn('content-length',parse_qs(urlparse(item['url']).query)['X-Amz-SignedHeaders'][0])
            receipts.append(item['receipt'])
        return receipts

    def test_adult_and_minor_files_commit_without_proxy_upload_and_preserve_private_access(self):
        for minor in [False,True]:
            from django.core.cache import cache
            cache.clear()
            if minor: self.invitation=self.new_invitation();self.url=f'/api/player-enrollments/public/{self.invitation.token}/'
            data, files=self.metadata(minor)
            data['uploaded_documents']=self.plan(files)
            result=self.client.post(self.url,data,format='json')
            self.assertEqual(result.status_code,201,result.data)
            row=PlayerEnrollment.objects.get(invitation=self.invitation)
            self.assertEqual(row.documents.count(),len(files))
            self.assertTrue(all(d.storage_path.startswith('r2://private-test/inscripciones/') and not d.content for d in row.documents.all()))
            self.upload_storage.assert_not_called()
            doc=row.documents.get(kind='player_photo')
            url=f'/api/player-enrollments/documents/{doc.pk}/'
            self.assertIn(self.client.get(url).status_code,[401,403])
            self.client.force_authenticate(self.other);self.assertEqual(self.client.get(url).status_code,404)
            self.client.force_authenticate(self.emilio)
            result=self.client.get(url);self.assertEqual(result.status_code,302)
            self.assertEqual(urlparse(result['Location']).hostname,'a'*32+'.r2.cloudflarestorage.com')
            self.assertEqual(result['Cache-Control'],'private, no-store')
            result=self.client.get(url+'?delivery=direct');self.assertEqual(result.status_code,200)
            self.assertIn('r2.cloudflarestorage.com',result.data['url'])
            self.client.force_authenticate(None)
            result=self.client.post(self.url+'uploads/',{'files':[]},format='json');self.assertEqual(result.status_code,400)

    def test_tickets_cannot_be_moved_to_another_invitation_or_tampered_or_duplicated(self):
        data,files=self.metadata();tickets=self.plan(files)
        other=self.new_invitation();url=f'/api/player-enrollments/public/{other.token}/'
        for receipts in [tickets,[tickets[0]+'broken',*tickets[1:]],[tickets[0]]*len(tickets)]:
            result=self.client.post(url,{**data,'uploaded_documents':receipts},format='json');self.assertEqual(result.status_code,400,result.data)
        self.copy.assert_not_called();self.assertFalse(PlayerEnrollment.objects.exists())

    def test_mismatched_bytes_or_expired_tickets_do_not_create_records(self):
        data,files=self.metadata();tickets=self.plan(files)
        claim=signing.loads(tickets[0],salt=UPLOAD_SALT);self.objects[claim['path']]=b'changed'
        result=self.client.post(self.url,{**data,'uploaded_documents':tickets},format='json');self.assertEqual(result.status_code,400)
        with patch('django.core.signing.time.time',return_value=timezone.now().timestamp()+1300):
            result=self.client.post(self.url,{**data,'uploaded_documents':tickets},format='json');self.assertEqual(result.status_code,400)
        self.copy.assert_not_called();self.assertFalse(PlayerEnrollment.objects.exists())

    def test_small_selfie_or_blank_signature_is_rejected_before_copy(self):
        for kind in ['player_photo','player_signature']:
            from django.core.cache import cache
            cache.clear()
            data,files=self.metadata()
            if kind=='player_photo':
                small=Image.new('RGB',(400,500),'white');b=BytesIO();small.save(b,'JPEG');content=b.getvalue()
            else: content=image_file('blank.png',blank=True).read()
            files[kind]['content']=content
            data['uploaded_documents']=self.plan(files)
            result=self.client.post(self.url,data,format='json');self.assertEqual(result.status_code,400,result.data)
        self.copy.assert_not_called()

    def test_expired_or_wrong_purpose_invitation_does_not_authorize_uploads(self):
        self.invitation.expires_at=timezone.now()-timedelta(seconds=1);self.invitation.save()
        self.assertEqual(self.client.post(self.url+'uploads/',{'files':[]},format='json').status_code,400)
        self.assertEqual(self.client.post(f'/api/player-enrollments/withdrawal/{self.invitation.token}/uploads/',{'files':[]},format='json').status_code,404)

    def test_withdrawal_signature_is_shared_and_still_private(self):
        # Create one real fixture enrollment through direct upload.
        data,files=self.metadata();data['uploaded_documents']=self.plan(files)
        self.assertEqual(self.client.post(self.url,data,format='json').status_code,201)
        row=PlayerEnrollment.objects.get();link=self.new_withdrawal()
        signatures={'withdrawal_signature':{'content':image_file('baja.png').read(),'mime':'image/png'}}
        receipts=self.plan(signatures,link,'withdraw')
        url=f'/api/player-enrollments/withdrawal/{link.token}/'
        result=self.client.post(url,{'enrollment_ids':[row.pk],'accepted':True,'uploaded_documents':receipts},format='json')
        self.assertEqual(result.status_code,200,result.data)
        self.assertTrue(row.documents.get(kind='withdrawal_signature').storage_path.startswith('r2://'))
        self.assertEqual(self.client.get(url+f'photos/{row.pk}/').status_code,400)

    def test_signed_urls_are_bucket_bound_and_reject_path_traversal(self):
        signed = enrollment_r2.signed_url('r2://private-test/example', expires=120)
        self.assertEqual(parse_qs(urlparse(signed).query)['X-Amz-Expires'], ['120'])
        with self.assertRaises(ValueError):enrollment_r2.signed_url('r2://other-bucket/key')
        with self.assertRaises(ValueError):enrollment_r2.signed_url('r2://private-test/../key')

    def test_migration_copies_verifies_and_preserves_originals_and_is_idempotent(self):
        import tempfile
        from pathlib import Path
        from django.core.management import call_command
        from io import StringIO
        self.assertEqual(self.client.post(self.url,self.payload(),format='multipart').status_code,201)
        original_paths=set(PlayerEnrollmentDocument.objects.values_list('storage_path',flat=True))
        with tempfile.TemporaryDirectory() as directory:
            output=StringIO()
            with patch('core.services.enrollment_r2.upload',side_effect=lambda path,content,mime:self.objects.__setitem__(path,content)):
                call_command('migrate_enrollment_files_to_r2',apply=True,backup_path=str(Path(directory)/'refs.json'),stdout=output)
            import json
            report=json.loads(output.getvalue());self.assertEqual(report['migrated_references'],4);self.assertEqual(report['failures'],[])
            self.assertTrue(original_paths.issubset(self.storage))
            self.assertTrue(all(path.startswith('r2://') for path in PlayerEnrollmentDocument.objects.values_list('storage_path',flat=True)))
            output=StringIO();call_command('migrate_enrollment_files_to_r2',stdout=output)
            self.assertEqual(json.loads(output.getvalue())['pending_references'],0)
        self.delete_storage.assert_not_called();self.delete.assert_not_called()
