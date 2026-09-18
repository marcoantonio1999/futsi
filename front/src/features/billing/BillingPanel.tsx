import type { AppData } from "../../types";
import { money } from "../../utils/format";
import { BillingCollectionPanel } from "./BillingCollectionPanel";
import type { BillingMutation } from "./billingFlow";
import "./billing.css";

export type BillingSection = "program" | "scheduled";
export function BillingPanel({ data, token, section = "scheduled", onCreatePlan, onCreateCharge, onCreatePayment, onCreateDiscount, onApproveDiscount, onRejectDiscount }: {
  data: AppData; token?: string; section?: BillingSection;
  onCreateCharge: BillingMutation; onCreatePayment: BillingMutation; onCreateDiscount: BillingMutation;
  onCreatePlan?: BillingMutation;
  onApproveDiscount: (id: number) => void; onRejectDiscount: (id: number) => void;
}) {
  return <div className="billing-workspace">
    <BillingCollectionPanel data={data} token={token} onCreatePlan={onCreatePlan} onCreateCharge={onCreateCharge} onCreatePayment={onCreatePayment} onCreateDiscount={onCreateDiscount} renderStudentExtras={student => {
      const discounts = data.discounts.filter(item => item.status === "requested" && item.student === student.id);
      if (!discounts.length) return null;
      return <section className="billing-box"><h3 className="font-semibold">Descuentos por autorizar ({discounts.length})</h3>
      {discounts.map(item => <div key={item.id} className="billing-charge"><div><h3>{item.student_name} · ${money(item.amount)}</h3><p className="billing-muted">{item.charge_concept} · {item.reason} · {item.signed_by_username || item.requested_by_username}</p></div>
        <button type="button" className="billing-primary" onClick={() => onApproveDiscount(item.id)}>Aprobar</button><button type="button" className="billing-secondary" onClick={() => onRejectDiscount(item.id)}>Rechazar</button>
      </div>)}
    </section>;
    }} />
  </div>;
}
