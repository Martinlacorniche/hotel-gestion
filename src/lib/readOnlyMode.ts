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
//
// `users` = les préférences personnelles (thème, police, emoji, hôtel par
// défaut, ordre des tuiles). Régler l'apparence de son propre outil n'est pas
// du travail non plus — et /profil est justement dans les chemins autorisés
// hors shift : la page s'ouvrait, mais chaque clic sur un thème repartait en
// « Hors service — lecture seule » sans rien enregistrer (signalé par un
// salarié le 30/07/2026).
// Ouvrir la table ici ne donne aucun pouvoir supplémentaire : côté base, la
// policy `users_update_self` limite à sa propre ligne et le GRANT UPDATE de
// `authenticated` ne porte que sur les colonnes de préférences (ni `role`,
// ni `hotel_id`, ni `active`). Ce drapeau est une frontière d'usage, pas de
// sécurité — cf. le commentaire d'en-tête de ShiftContext.
export const READONLY_WRITE_WHITELIST = ['cp_requests', 'users'];
