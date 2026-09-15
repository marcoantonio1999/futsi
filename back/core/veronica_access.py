from rest_framework.permissions import BasePermission

VERONICA_ONLY = "veronica_only"


def is_veronica_only(user):
    return bool(user and user.is_authenticated and VERONICA_ONLY in (user.section_permissions or []))


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
        ))
