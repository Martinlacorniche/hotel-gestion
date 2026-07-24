# Junior — l'agent qui enquête

Tourne sur le serveur de La Corniche (`serveur-corniche`, Tailscale
`100.70.218.103`, user `htbm`), pas sur Netlify : une enquête dure des minutes,
une fonction serverless est coupée bien avant.

## Ce qu'il est, et ce qu'il n'est pas

- **Lecture seule.** Aucun outil d'écriture : il cherche, lit, croise, explique.
  Tout ce qui modifie quoi que ce soit passe par l'app, avec un clic humain.
  C'est la barrière : même mal aiguillé, il ne peut rien casser.
- **Jamais de sa propre initiative.** Un humain le sollicite depuis `/junior`.
- **Il n'écrit pas ses propres règles.** L'apprentissage vient des corrections
  humaines, réinjectées dans le classifieur (`assistant_mail_corrections`).
- Plafonds : 12 tours, 4 minutes, 60 lignes par requête, 20 000 caractères par
  résultat d'outil.

## Déployer une modification

    scp agent-junior/agent.mjs htbm@100.70.218.103:~/agent-junior/agent.mjs
    ssh htbm@100.70.218.103 'systemctl --user restart agent-junior'

État et journal :

    systemctl --user status agent-junior
    journalctl --user -u agent-junior -f

## Installation (pour mémoire)

- `~/agent-junior/` : `agent.mjs`, `package.json` (seule dépendance
  `@anthropic-ai/sdk`), `.env` en 600 (Graph, Supabase service_role, clé
  Anthropic, `AGENT_SECRET`).
- Service **utilisateur** systemd (`~/.config/systemd/user/agent-junior.service`) :
  pas de root — `sudo` exige un mot de passe sur cette machine — et `Linger` est
  actif, donc il démarre au boot. Borné `MemoryMax=900M` / `CPUQuota=140%` : la
  machine porte aussi les écrans des 23 chambres.
- Exposition : `tailscale funnel --bg --set-path=/agent 5055`, à côté du
  Chromecast qui garde `/`.
  ⚠️ **Le Funnel retire le préfixe** : `/agent/sante` arrive au service en
  `/sante`. Le code accepte les deux formes.

## Ajouter un accès

Les registres du quotidien (consignes, demandes, tickets, maintenance, chambres
libérées, planning) passent par **un seul outil**, `vie_de_lhotel`, avec un
paramètre `registre`. Ajouter une table = ajouter une ligne à ce registre, pas un
outil de plus : multiplier les outils dilue le choix du modèle et fait grossir le
prompt à chaque nouveauté de l'app.
