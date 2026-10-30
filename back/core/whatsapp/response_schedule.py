"""On-demand working-time arithmetic. No polling, jobs or message rewrites."""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
from rest_framework import serializers
from core.models import WhatsAppSiteResponseSchedule, WhatsAppAutomationSettings

MEXICO = ZoneInfo('America/Mexico_City')


def default_schedule(site_id=None):
    return WhatsAppSiteResponseSchedule(site_id=site_id, days=list(range(7)), starts_at=time(9), ends_at=time(20))


def get_schedule(site_id=None):
    return (WhatsAppSiteResponseSchedule.objects.filter(site_id=site_id).first() if site_id else None) or default_schedule(site_id)


class ScheduleResolver:
    """Two bounded reads per report; never one database query per chat."""
    def __init__(self):
        self.schedules = {s.site_id:s for s in WhatsAppSiteResponseSchedule.objects.all()}
        self.channel_sites = dict(WhatsAppAutomationSettings.objects.exclude(site_id=None).values_list('business_address','site_id'))
        self.default = default_schedule()

    def for_site(self, site_id):
        return self.schedules.get(site_id, self.default)

    def site_of(self, conversation):
        return getattr(conversation, 'channel_site_id', None) or self.channel_sites.get(conversation.to_address) or conversation.site_id

    def for_conversation(self, conversation):
        return self.for_site(self.site_of(conversation))

    def any_open(self, at):
        return any(is_working(at,s) for s in [self.default,*self.schedules.values()])


class ResponseScheduleSerializer(serializers.ModelSerializer):
    starts_at = serializers.TimeField(format='%H:%M', input_formats=['%H:%M'])
    ends_at = serializers.TimeField(format='%H:%M', input_formats=['%H:%M'])
    days = serializers.ListField(child=serializers.IntegerField(min_value=0, max_value=6), allow_empty=False, max_length=7)

    class Meta:
        model = WhatsAppSiteResponseSchedule
        fields = ['days', 'starts_at', 'ends_at']

    def validate(self, attrs):
        if len(set(attrs['days'])) != len(attrs['days']):
            raise serializers.ValidationError('No repitas días.')
        if attrs['starts_at'] >= attrs['ends_at']:
            raise serializers.ValidationError('El cierre debe ser posterior a la apertura.')
        attrs['days'] = sorted(attrs['days'])
        return attrs


def schedule_data(schedule):
    return {**ResponseScheduleSerializer(schedule).data, 'timezone': str(MEXICO), 'site':schedule.site_id}


def is_working(at, schedule):
    local = at.astimezone(MEXICO)
    return local.weekday() in schedule.days and schedule.starts_at <= local.time() < schedule.ends_at


def working_seconds(start, end, schedule=None):
    schedule = schedule or get_schedule()
    if not start or not end or end <= start:
        return 0
    start, end = start.astimezone(MEXICO), end.astimezone(MEXICO)
    def part(day, lower, upper):
        if day.weekday() not in schedule.days:
            return 0
        opening = datetime.combine(day, schedule.starts_at, MEXICO)
        closing = datetime.combine(day, schedule.ends_at, MEXICO)
        return max(0, int((min(upper, closing) - max(lower, opening)).total_seconds()))
    if start.date() == end.date():
        return part(start.date(), start, end)
    total = part(start.date(), start, datetime.combine(start.date(), time.max, MEXICO))
    total += part(end.date(), datetime.combine(end.date(), time.min, MEXICO), end)
    # At most six individual dates, regardless of how old a request is.
    full_days = (end.date() - start.date()).days - 1
    weeks, remaining = divmod(full_days, 7)
    duration = (datetime.combine(start.date(), schedule.ends_at) - datetime.combine(start.date(), schedule.starts_at)).total_seconds()
    count = weeks * len(schedule.days)
    count += sum((start.date() + timedelta(days=i+1)).weekday() in schedule.days for i in range(remaining))
    return total + int(count * duration)
