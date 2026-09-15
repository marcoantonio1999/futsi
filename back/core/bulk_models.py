"""Durable, channel-scoped bulk template jobs. No provider credentials."""
import uuid
from django.conf import settings
from django.db import models

class WhatsAppBulkCampaign(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    channel = models.CharField(max_length=64, db_index=True)
    channel_kind = models.CharField(max_length=16)
    actor_id = models.BigIntegerField()
    title = models.CharField(max_length=120)
    template = models.JSONField(default=dict)
    quote = models.JSONField(default=dict)
    status = models.CharField(max_length=20, default="draft", db_index=True)
    consent_at = models.DateTimeField(null=True)
    heartbeat_at = models.DateTimeField(null=True)
    detail = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "whatsapp_bulk_campaigns"
        managed = True

class WhatsAppBulkRecipient(models.Model):
    campaign = models.ForeignKey("WhatsAppBulkCampaign", on_delete=models.CASCADE, related_name="recipients")
    phone = models.CharField(max_length=16)
    name = models.CharField(max_length=120, blank=True, default='', db_default='')
    status = models.CharField(max_length=20, default="pending", db_index=True)
    message_id = models.CharField(max_length=255, blank=True, db_index=True)
    detail = models.CharField(max_length=500, blank=True)
    started_at = models.DateTimeField(null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "whatsapp_bulk_recipients"
        managed = True
        constraints = [models.UniqueConstraint(fields=["campaign", "phone"], name="uq_bulk_campaign_phone")]

class WhatsAppBulkReceipt(models.Model):
    channel = models.CharField(max_length=64)
    message_id = models.CharField(max_length=255)
    events = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "whatsapp_bulk_receipts"
        managed = True
        constraints = [models.UniqueConstraint(fields=["channel", "message_id"], name="uq_bulk_receipt_channel_sid")]
