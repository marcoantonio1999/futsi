from .common import *

def charge_balance(charge):
    paid = charge.payments.filter(status__in=["registered", "reconciled"]).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    discounted = charge.discounts.filter(status="approved").aggregate(total=Sum("amount"))["total"] or Decimal("0")
    balance = charge.amount - paid - discounted
    return max(balance, Decimal("0"))


def sync_charge_status(charge):
    balance = charge_balance(charge)
    if charge.status == "canceled":
        return
    if balance <= 0:
        charge.status = "paid"
    elif balance < charge.amount:
        charge.status = "partial"
    else:
        charge.status = "pending"
    charge.save(update_fields=["status", "updated_at"])

