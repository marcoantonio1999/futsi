import React from "react";
import { money } from "../../../utils/format";
import type { StaffPaymentRequest, User } from "../../../types";
import { staffPaymentKindLabel, staffPaymentStatusLabel } from "./labels";
import { StatusPill, TableHeader } from "./ui";

export function StaffPaymentInbox({
  requests,
  currentUser,
  onAccept,
  onReject,
}: {
  requests: StaffPaymentRequest[];
  currentUser?: User;
  onAccept: (requestId: number) => void;
  onReject: (requestId: number) => void;
}) {
  const visibleRequests = currentUser
    ? requests.filter((request) => request.recipient === currentUser.id || request.recipient_username === currentUser.username)
    : requests;
  const sorted = [...visibleRequests].sort((a, b) => {
    if (a.status === b.status) return b.id - a.id;
    return a.status === "requested" ? -1 : 1;
  });

  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <TableHeader title={currentUser ? "Mis pagos por aceptar" : "Solicitudes de pago a personal"} count={sorted.length} />
      <div className="divide-y divide-zinc-100">
        {sorted.slice(0, 8).map((request) => {
          const canRespond = request.status === "requested" && (!currentUser || request.recipient === currentUser.id || request.recipient_username === currentUser.username);
          return (
            <div key={request.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{request.recipient_name || request.recipient_username} - ${money(request.amount)}</p>
                  <StatusPill label={staffPaymentStatusLabel(request.status)} />
                </div>
                <p className="mt-1 text-sm text-zinc-500">
                  {request.site_name} - {staffPaymentKindLabel(request.kind)} - {request.requested_payment_date}
                </p>
                <p className="mt-1 text-sm text-zinc-500">{request.description}</p>
                <p className="mt-1 text-xs text-zinc-400">Solicito: {request.requested_by_username || "N/D"}</p>
              </div>
              {canRespond && (
                <div className="flex gap-2">
                  <button className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white" onClick={() => onAccept(request.id)}>
                    Aceptar pago
                  </button>
                  <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium" onClick={() => onReject(request.id)}>
                    Rechazar
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {sorted.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin solicitudes pendientes.</p>}
      </div>
    </div>
  );
}

