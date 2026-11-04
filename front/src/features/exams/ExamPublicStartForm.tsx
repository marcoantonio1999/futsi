import type { FormEvent } from 'react';

export type PublicExamInfo = {
  title: string; instructions: string; duration_minutes: number; question_count: number;
  accepting: boolean; second_stage?: boolean; phone_access?: boolean;
};
export type StartMethod = 'email' | 'phone';

export function ExamPublicStartForm({ info, busy, method, onMethodChange, onSubmit }: {
  info: PublicExamInfo; busy: boolean; method: StartMethod;
  onMethodChange: (method: StartMethod) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const byPhone = !!info.second_stage && method === 'phone';
  return <form onSubmit={onSubmit}>
    <h2>Antes de comenzar</h2>
    {info.second_stage && <p className="exam-notice">{byPhone
      ? 'Escribe tu nombre completo y teléfono. Si ya compartiste tu número con Recursos Humanos, usa ese mismo.'
      : 'Usa el mismo correo que registraste en la primera evaluación. Si no puedes comenzar, consulta a Recursos Humanos.'}</p>}
    {info.second_stage && info.phone_access && <div role="group" aria-label="Forma de identificación" className="exam-actions">
      <button type="button" aria-pressed={!byPhone} className={!byPhone ? 'exam-primary' : ''} onClick={() => onMethodChange('email')}>Con mi correo</button>
      <button type="button" aria-pressed={byPhone} className={byPhone ? 'exam-primary' : ''} onClick={() => onMethodChange('phone')}>Con nombre y teléfono</button>
    </div>}
    <p>El tiempo empieza al pulsar «Iniciar examen».</p>
    {(!info.second_stage || byPhone) && <label>Nombre completo<input name="name" required autoComplete="name" maxLength={180} /></label>}
    {!byPhone && <label>Correo electrónico<input name="email" type="email" required autoComplete="email" maxLength={254} /></label>}
    {(!info.second_stage || byPhone) && <label>Teléfono<input name="phone" type="tel" required autoComplete="tel" maxLength={30} /></label>}
    <label className="exam-consent"><input name="consent" type="checkbox" required /><span>{info.second_stage
      ? 'Autorizo a BPower y su equipo de Recursos Humanos a guardar mis datos, respuestas y tiempo de evaluación y utilizar IA para apoyar la revisión de mis respuestas.'
      : 'Autorizo a BPower y su equipo de Recursos Humanos a guardar mis datos, respuestas y tiempo de evaluación para revisar mi postulación.'}</span></label>
    <button className="exam-primary" disabled={busy}>{busy ? 'Iniciando…' : 'Iniciar examen'}</button>
  </form>;
}
