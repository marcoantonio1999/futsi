export const auditPeriods = [
  {key:'week', label:'Última semana', days:7},
  {key:'three_days', label:'Últimos 3 días', days:3},
  {key:'day', label:'Último día', days:1},
  {key:'month', label:'Último mes', days:30},
] as const;
export type AuditRange = typeof auditPeriods[number]['key'];
