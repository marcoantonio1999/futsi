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


def weekly_hours(schedule):
    saved = getattr(schedule, 'weekly_hours', None)
    if saved is not None:
        return saved
    return {str(day):[{'start':schedule.starts_at.strftime('%H:%M'),'end':schedule.ends_at.strftime('%H:%M')}]
            if day in schedule.days else [] for day in range(7)}


class WeeklyHoursSerializer(serializers.Serializer):
    weekly_hours = serializers.JSONField()

    def validate_weekly_hours(self, value):
        import re
        if not isinstance(value, dict) or set(value) != {str(d) for d in range(7)}:
            raise serializers.ValidationError('Incluye los siete días, de lunes a domingo.')
        result = {}
        count = 0
        for day, slots in value.items():
            if not isinstance(slots, list) or len(slots)>4:
                raise serializers.ValidationError('Se admiten hasta cuatro horarios por día.')
            cleaned = []
            for slot in slots:
                if not isinstance(slot, dict) or set(slot) != {'start','end'} or any(
                    not isinstance(slot[k],str) or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]',slot[k]) for k in ('start','end')):
                    raise serializers.ValidationError('Usa horas válidas en formato HH:MM.')
                if slot['start'] >= slot['end']:
                    raise serializers.ValidationError('Cada cierre debe ser posterior a su apertura.')
                cleaned.append({'start':slot['start'],'end':slot['end']})
            cleaned.sort(key=lambda s:s['start'])
            if any(a['end']>b['start'] for a,b in zip(cleaned,cleaned[1:])):
                raise serializers.ValidationError('Los horarios de un mismo día no deben superponerse.')
            result[day] = cleaned
            count += len(cleaned)
        if not count:
            raise serializers.ValidationError('Agrega al menos un horario laboral.')
        return result


def schedule_data(schedule):
    return {**ResponseScheduleSerializer(schedule).data, 'weekly_hours':weekly_hours(schedule), 'timezone': str(MEXICO), 'site':schedule.site_id}


def is_working(at, schedule):
    local = at.astimezone(MEXICO)
    return any(time.fromisoformat(s['start']) <= local.time() < time.fromisoformat(s['end'])
               for s in weekly_hours(schedule)[str(local.weekday())])


def working_seconds(start, end, schedule=None):
    schedule = schedule or get_schedule()
    if not start or not end or end <= start:
        return 0
    start, end = start.astimezone(MEXICO), end.astimezone(MEXICO)
    hours = weekly_hours(schedule)
    def part(day, lower, upper):
        total = 0
        for slot in hours[str(day.weekday())]:
            opening = datetime.combine(day, time.fromisoformat(slot['start']), MEXICO)
            closing = datetime.combine(day, time.fromisoformat(slot['end']), MEXICO)
            total += max(0,int((min(upper,closing)-max(lower,opening)).total_seconds()))
        return total
    if start.date() == end.date():
        return part(start.date(), start, end)
    total = part(start.date(), start, datetime.combine(start.date(), time.max, MEXICO))
    total += part(end.date(), datetime.combine(end.date(), time.min, MEXICO), end)
    # At most six individual dates, regardless of how old a request is.
    full_days = (end.date() - start.date()).days - 1
    weeks, remaining = divmod(full_days, 7)
    daily = {d:sum((datetime.combine(start.date(),time.fromisoformat(s['end'])) - datetime.combine(start.date(),time.fromisoformat(s['start']))).total_seconds()
                   for s in hours[str(d)]) for d in range(7)}
    total += weeks * sum(daily.values())
    total += sum(daily[(start.date()+timedelta(days=i+1)).weekday()] for i in range(remaining))
    return int(total)
