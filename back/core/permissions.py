from rest_framework.permissions import SAFE_METHODS, BasePermission


ADMIN_ROLES = {"admin", "owner", "dev"}
OPERATIONS_ROLES = {"admin", "owner", "dev", "accounting", "site_coordinator"}
GUARDIAN_ROLES = {"guardian"}
ADULT_ROLES = {"adult_representative", "adult_player"}
CASHIER_ROLES = {"cashier"}
COACH_ROLES = {"coach"}


class IsAdminRole(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in ADMIN_ROLES)


class IsOperationsRole(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in OPERATIONS_ROLES)


class IsOperationsOrGuardianRole(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in (OPERATIONS_ROLES | GUARDIAN_ROLES | ADULT_ROLES)
        )


class IsOperationsCashierOrGuardianRole(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in (OPERATIONS_ROLES | CASHIER_ROLES | GUARDIAN_ROLES | ADULT_ROLES)
        )


class IsOperationsCoachOrGuardianRole(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in (OPERATIONS_ROLES | COACH_ROLES | GUARDIAN_ROLES | ADULT_ROLES)
        )


class IsOperationsCashierCoachOrGuardianRole(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in (OPERATIONS_ROLES | CASHIER_ROLES | COACH_ROLES | GUARDIAN_ROLES | ADULT_ROLES)
        )


class IsOperationsOrCoachRole(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in (OPERATIONS_ROLES | COACH_ROLES)
        )


class IsOperationsOrCashierRole(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in (OPERATIONS_ROLES | CASHIER_ROLES)
        )


class IsOperationsCashierOrCoachRole(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in (OPERATIONS_ROLES | CASHIER_ROLES | COACH_ROLES)
        )


class IsAdminForWrites(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return request.user.role in ADMIN_ROLES
