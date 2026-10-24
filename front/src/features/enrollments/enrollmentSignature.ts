// Use the identity recorded at enrollment, not the player's current age.
export function enrollmentSignatureKind(record: { identity_type?: string }) {
  return record.identity_type === 'minor' ? 'guardian_signature' : 'player_signature';
}
