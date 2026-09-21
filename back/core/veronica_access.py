import re

from rest_framework.permissions import BasePermission

VERONICA_ONLY = "veronica_only"
COURT_COMMUNICATIONS_ONLY = "court_communications_only"
WHATSAPP_CHANNEL_PERMISSION_PREFIX = "whatsapp_channel:"


def is_veronica_only(user):
    return bool(user and user.is_authenticated and VERONICA_ONLY in (user.section_permissions or []))


def is_court_communications_only(user):
    return bool(user and user.is_authenticated and COURT_COMMUNICATIONS_ONLY in (user.section_permissions or []))


def court_communications_allowed_channels(user):
    if not is_court_communications_only(user):
        return None
    return {
        permission[len(WHATSAPP_CHANNEL_PERMISSION_PREFIX):]
        for permission in (user.section_permissions or [])
        if isinstance(permission, str)
        and permission.startswith(WHATSAPP_CHANNEL_PERMISSION_PREFIX)
        and permission[len(WHATSAPP_CHANNEL_PERMISSION_PREFIX):]
    }


def court_communications_route_allowed(path, method):
    exact = {
        "/api/auth/me/": {"GET", "HEAD"},
        "/api/auth/logout/": {"POST"},
        "/api/sites/": {"GET", "HEAD"},
        "/api/whatsapp-conversations/": {"GET", "HEAD"},
        "/api/whatsapp-conversations/channels/": {"GET", "HEAD"},
        "/api/whatsapp-conversations/assignees/": {"GET", "HEAD"},
        "/api/whatsapp-conversations/templates/": {"GET", "HEAD"},
    }
    if method in exact.get(path, set()):
        return True
    if re.fullmatch(r"/api/whatsapp-conversations/[1-9][0-9]*/", path):
        return method in {"GET", "HEAD", "PATCH"}
    if re.fullmatch(r"/api/whatsapp-conversations/[1-9][0-9]*/(?:send-message|resolve-attention)/", path):
        return method == "POST"
    if re.fullmatch(r"/api/whatsapp-bulk/(?:channels|catalog|list|detail|contacts|contact-detail)/", path):
        return method in {"GET", "HEAD"}
    if re.fullmatch(r"/api/whatsapp-bulk/(?:import|create|start|cancel|contact-select|contact-update)/", path):
        return method == "POST"
    return False


def veronica_route_allowed(path, method):
    allowed = {
        "/api/auth/me/": {"GET", "HEAD"},
        "/api/auth/logout/": {"POST"},
        "/api/veronica/inbox/": {"GET", "HEAD"},
        "/api/veronica/history/": {"GET", "HEAD"},
        "/api/veronica/templates/": {"GET", "HEAD"},
        "/api/veronica/send/": {"POST"},
        "/api/veronica/upload/": {"POST"},
        "/api/veronica/contact/": {"POST"},
        "/api/veronica/contact-filters/": {"POST"},
        "/api/veronica/filter-options/": {"GET", "HEAD", "POST"},
        "/api/veronica/auto-pdf/": {"GET", "HEAD", "POST"},
    }
    for operation in ('channels', 'catalog', 'list', 'detail', 'connections'):
        allowed[f'/api/veronica/bulk/{operation}/'] = {'GET', 'HEAD'}
    for operation in ('import', 'create', 'start', 'cancel'):
        allowed[f'/api/veronica/bulk/{operation}/'] = {'POST'}
    return method in allowed.get(path, set())


class CanUseVeronica(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and (
            user.role in {"admin", "owner", "dev"}
            or (user.role == "collaborator" and is_veronica_only(user))
            or (user.role == "site_coordinator" and is_court_communications_only(user))
        ))
