from django.db import models


class WhatsAppChannelDocument(models.Model):
    channel = models.CharField(max_length=64, unique=True)
    enabled = models.BooleanField(default=False)
    filename = models.CharField(max_length=120, blank=True)
    caption = models.CharField(max_length=1024, blank=True)
    content = models.BinaryField(default=bytes, editable=False)
    sha256 = models.CharField(max_length=64, blank=True)
    updated_by_id = models.BigIntegerField(null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'whatsapp_channel_documents'
        managed = True
