# Email templates Supabase

Templates HTML à coller dans **Dashboard Supabase → Authentication → Email Templates**.

| Fichier | Onglet Supabase | Sujet recommandé |
|---|---|---|
| `invite.html` | Invite user | `Invitation à rejoindre l'espace Consignes HTBM` |
| `reset_password.html` | Reset Password | `Réinitialisation de votre mot de passe` |

## Variables Go template utilisées

- `{{ .ConfirmationURL }}` — lien d'action (cliquable + visible en fallback texte)
- `{{ .Data.name }}` — nom du destinataire (uniquement disponible sur Invite, via `inviteUserByEmail(email, { data: { name } })`)
- `{{ .Email }}` — adresse email destinataire

## Design

- Largeur max 560px, padding généreux.
- Système de tables HTML pour compatibilité Outlook / Gmail / Apple Mail / mobile.
- Inline CSS (les `<style>` en head sont strippés par certains clients).
- Couleur primary `#4f46e5` (indigo-600) cohérente avec l'app.
- System fonts (max compat, pas de Google Fonts en email).

## Pour la duplication / vente (cf. backlog)

Quand on vendra l'app à d'autres hôtels, ces templates devront être paramétrisables :
- Nom hôtel (header + footer)
- Couleur primary
- Email expéditeur / domaine
- Logo (optionnel)
