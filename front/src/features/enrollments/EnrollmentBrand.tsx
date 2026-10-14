import enrollmentLogo from "./assets/inscripciones-bpower-logo.png";

/** Shared identity for the enrollment portal, independent of Futsi/Soccer WA logos. */
export function EnrollmentBrand() {
  return <span className="enrollment-brand"><img src={enrollmentLogo} alt="" aria-hidden="true" width={64} height={64} decoding="async" />
    <span className="enrollment-brand-name">Inscripciones <strong>BPower</strong></span>
  </span>;
}
