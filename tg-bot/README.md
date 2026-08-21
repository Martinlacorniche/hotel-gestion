# Bot Telegram — alertes machines, HACCP, écran

Deux moitiés qui ne vivent pas au même endroit, et c'est volontaire.

**Ce qui alerte** est dans Supabase (`pg_cron` + `pg_net`, migrations 100 à 105).
Un surveillant doit être ailleurs que ce qu'il surveille : depuis Supabase il
survit à une coupure de courant ou d'internet sur site, à une panne Netlify et
à la box de Martin.

**Ce qui agit** est ici, sur `serveur-corniche` (`~/tg-bot`), exposé par le
Funnel Tailscale sur `/tg` à côté de Junior. Netlify ne peut pas joindre cette
machine ; un bouton y aurait dû déposer un ordre dans une file relevée au cron
suivant. Ici l'action est immédiate.

```
serveur-corniche ─┐                                   ┌─ 🔴/🟢 machines  → sujet Serveur
                  ├→ Supabase ─(silence détecté)─────→ ├─ 🌡️ HACCP        → sujet Haccp
pc-tthotel-voiles ┘                                    └─ boutons ──┐
                                                                     ↓
                              Telegram ──webhook /tg──→ serveur-corniche (agit)
```

## Ce que le bot sait faire

| commande | effet |
|---|---|
| `/etat` | état du serveur + boutons de redémarrage |
| `/ecran <texte>` | affiche le texte sur l'écran de la réception |
| `/aide` | rappelle les commandes |

Boutons d'acquittement HACCP : « J'ai vu », « Porte restée ouverte »,
« Frigoriste appelé ». Ils écrivent dans `haccp_alerts.action_taken` en
concaténant — une suite d'actions, pas une correction. Les boutons **restent
actifs** après un appui : acquitter puis appeler le frigoriste une demi-heure
plus tard est un enchaînement normal.

## Sécurité

Trois barrières, dans cet ordre :

1. l'en-tête `X-Telegram-Bot-Api-Secret-Token` (posé par `setWebhook`) — sinon 403 ;
2. l'identifiant Telegram de l'appelant, comparé à `TG_ADMIN_ID` ;
3. une liste blanche de services **doublée** de `/etc/sudoers.d/telegram-actions`.

Sans la 3, les deux premières ne suffiraient pas : une faille ne doit pas donner
un `systemctl` général. La règle sudoers n'autorise que `restart` sur
`chromecast-hotel` et `screen-relay`, sans joker.

⚠️ `SERVICES` dans `tg_bot.py` doit rester aligné avec `sudoers-telegram` :
y ajouter un service sans ajouter la ligne sudoers donne un bouton qui échoue
en silence.

## Déployer une modification

    scp tg-bot/tg_bot.py htbm@100.70.218.103:~/tg-bot/tg_bot.py
    ssh htbm@100.70.218.103 'systemctl --user restart tg-bot'

État et journal :

    ssh serveur-htbm 'systemctl --user status tg-bot'
    ssh serveur-htbm 'journalctl --user -u tg-bot -f'

## Installation (pour mémoire)

- `~/tg-bot/` : `tg_bot.py`, `.env` en 600. **Aucune dépendance** — que la
  bibliothèque standard Python, donc pas de venv à maintenir.
- Service **utilisateur** systemd (`~/.config/systemd/user/tg-bot.service`) :
  `sudo` demande un mot de passe sur cette machine, et `Linger` est déjà actif
  (Junior s'en sert), donc il démarre au boot.
- Battement de cœur : `~/heartbeat/heartbeat.sh` en cron **toutes les minutes**
  (`crontab -l`). C'est lui qui alimente `machine_watch` ; son silence est ce
  qui déclenche l'alerte.
- Exposition : `tailscale funnel --bg --set-path=/tg 5056`.
  ⚠️ **Le Funnel retire le préfixe** : `/tg/sante` arrive au service en `/sante`.
- Webhook : `setWebhook` avec `secret_token`. Tant qu'un webhook est enregistré,
  `getUpdates` est indisponible — retrouver l'identifiant d'un sujet de forum
  passe donc par le journal du service, pas par l'API.

## Pièges rencontrés

- Le sujet **Général** ne s'adresse pas avec `message_thread_id: 1` (Telegram
  répond « message thread not found ») mais en **omettant** le champ.
- Il n'existe **aucune API** pour lister les sujets d'un forum. On les découvre
  en envoyant un message à chaque `message_thread_id` : la réponse porte le nom
  du sujet dans `reply_to_message.forum_topic_created.name`.
- En **mode confidentialité** (le défaut), un bot ne reçoit dans un groupe que
  les commandes qui lui sont adressées — un simple `test` ne lui parvient pas.
- Pas de `parse_mode` : un caractère spécial dans un message d'erreur suffisait
  à faire échouer l'envoi en 400. Le texte est envoyé brut.
- On acquitte le HTTP **avant** de traiter : sinon Telegram réémet pendant un
  redémarrage un peu long, et un bouton pressé une fois relancerait deux fois.

## Sujets du supergroupe Htbm

| sujet | thread | usage |
|---|---|---|
| Général | *(aucun)* | divers |
| Junior | 3 | à venir : questions en langage naturel |
| Haccp | 4 | alertes températures + acquittements |
| Serveur | 15 | machines hors ligne, panneau de commande |

Les identifiants sont dans le Vault (`telegram_thread_machines`,
`telegram_thread_haccp`), pas en dur : réorganiser les sujets ne doit pas
demander une migration.
