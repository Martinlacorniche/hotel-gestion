// Drapeau global "lecture seule" du mode shift, lu par le wrapper du client
// Supabase. Posé par ShiftProvider quand un salarié (rôle user) est hors de
// sa plage de service. Module séparé pour éviter tout cycle d'import.

let readOnly = false;

export function setReadOnlyMode(value: boolean) {
  readOnly = value;
}

export function isReadOnlyMode() {
  return readOnly;
}

// Tables encore autorisées en écriture hors shift : poser une demande de
// congés depuis chez soi n'est pas "du travail".
export const READONLY_WRITE_WHITELIST = ['cp_requests'];
