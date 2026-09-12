export function deliveryProblem(status: string, codes: number[] = []) {
  if (status === "failed") return {
    title: "No se entregó el mensaje",
    explanation: codes.includes(131042)
      ? "Meta rechazó el envío por un problema de habilitación o pagos de la cuenta de WhatsApp de Verónica."
      : "WhatsApp informó que este envío falló. El contacto no recibió este mensaje.",
    action: codes.includes(131042)
      ? "El administrador de la cuenta debe revisar el método de pago, los saldos pendientes y las restricciones en Meta. Si todo está correcto, contacta a soporte de Dualhook. No repitas el envío hasta aclarar la causa."
      : "Revisa el número con código de país y consulta a soporte con el detalle técnico antes de volver a enviar.",
  };
  if (status === "uncertain") return {
    title: "No pudimos confirmar el envío",
    explanation: "No sabemos todavía si el contacto recibió este mensaje.",
    action: "Actualiza el historial y confirma con el contacto o soporte. No lo reenvíes todavía: podrías duplicarlo.",
  };
  return null;
}
