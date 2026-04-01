# Roadmap Feed-Digest

**Objectif** : Gagner du temps sur le triage — jeter ou sauvegarder un article en quelques secondes.

**Contrainte** : Comptes gratuits (Gemini Free Tier, Notion Free, etc.). Chaque appel LLM compte. Privilégier systématiquement les solutions sans coût API : heuristiques, logique déterministe, traitement local.

---

## Phase 1 — Réduction du bruit (zéro coût LLM)

*Toutes ces features fonctionnent sans aucun appel API supplémentaire.*

### 1.1 Normalisation des tags

| | |
|---|---|
| **Coût LLM** | Aucun |
| **Effort** | Faible |

**Problème** : Le LLM renvoie des tags avec des casses différentes d'un run à l'autre ("Machine Learning" vs "machine learning"). Conséquences :
- Tags comptés séparément dans le dashboard (graphes faussés)
- Préférences de tags fragmentées (un override sur "React" n'affecte pas "react")
- Importance scoring incohérent (seuil 0.6 calculé sur des tags éclatés)

**Solution** :
- [ ] Normaliser les tags en `lowercase` + `trim` dès la sortie du LLM (`parseResponse()` dans les adapters Claude et Gemini)
- [ ] Appliquer la même normalisation dans `computeImportance()`
- [ ] Migration one-shot des tag preferences existantes : fusionner les entrées en doublon (additionner les compteurs)
- [ ] Normaliser côté API (endpoint `setTagOverride`) et côté Telegram (callbacks `toggle:`)

### 1.2 Déduplication des articles

| | |
|---|---|
| **Coût LLM** | Aucun |
| **Effort** | Moyen |

**Problème** : Plusieurs flux RSS relayent le même article (reprise, syndication). On trie 3 fois la même info.

**Solution** :
- [ ] Détection par URL canonique : même domaine + path, paramètres query ignorés
- [ ] Détection par similarité de titre : distance de Jaccard sur les mots normalisés (seuil configurable, ex: > 0.7)
- [ ] Regrouper les doublons : garder le plus complet (contenu le plus long), marquer les autres `duplicate: true` avec référence au principal
- [ ] Badge "doublon" dans le dashboard, cliquable pour voir les variantes
- [ ] Les doublons n'apparaissent pas dans l'inbox par défaut (filtrés), consultables via un toggle

### 1.3 Auto-archive du bruit évident

| | |
|---|---|
| **Coût LLM** | Aucun |
| **Effort** | Faible |

**Problème** : Articles vides, brèves de 2 lignes, erreurs de scraping, pubs — du bruit pur.

**Solution** :
- [ ] Règles heuristiques pré-pipeline (avant tout appel LLM) :
  - Contenu < 100 caractères après nettoyage HTML → auto-archive
  - Titre matche des patterns publicitaires (liste configurable, ex: "Sponsored", "Publicité", "Advertorial")
  - URL dans une blacklist de domaines (configurable)
- [ ] Marquage `autoArchived: true` (pas de suppression, reste consultable dans un onglet "Archivé")
- [ ] Compteur dans le résumé de run : "X articles auto-archivés"
- [ ] Restauration en un clic si faux positif
- [ ] **Bonus coût** : ces articles ne sont plus envoyés au LLM → économise des appels Gemini

### 1.4 Triage par raccourcis rapides

| | |
|---|---|
| **Coût LLM** | Aucun |
| **Effort** | Moyen |

**Problème** : La vue Triage fonctionne mais chaque décision prend trop de temps. L'objectif est le throughput.

**Solution** :
- [ ] Raccourcis clavier en vue Triage :
  - `d` = archiver (dismiss)
  - `s` = sauvegarder
  - `→` ou `n` = skip (article suivant sans décision)
  - `z` = annuler la dernière action (undo)
- [ ] Mode "speed triage" : affiche uniquement titre + 1re phrase du résumé + tags + importance — décider en 2 secondes
- [ ] Gestes swipe sur mobile : gauche = archiver, droite = sauvegarder
- [ ] Compteur de progression visible et temps moyen par décision

---

## Phase 2 — Scoring intelligent (coût LLM marginal)

*Ces features exploitent l'appel LLM existant (enrich) ou ajoutent un surcoût minimal.*

### 2.1 Score de pertinence dans l'appel existant

| | |
|---|---|
| **Coût LLM** | Zéro appel supplémentaire — ajouté au prompt `enrich()` existant |
| **Effort** | Moyen |

**Problème** : Le scoring actuel repose uniquement sur l'historique des tags. Un article sur un sujet nouveau mais pertinent aura un score bas.

**Solution** :
- [ ] Ajouter `relevanceScore: number` (1-10) au JSON de réponse du LLM dans le prompt `enrich()` existant
- [ ] Profil utilisateur simple : un fichier texte avec centres d'intérêt, injecté dans le prompt (ex: "développement web, IA, sécurité, open source")
- [ ] Page "Mes centres d'intérêt" dans le dashboard pour éditer ce profil
- [ ] Score combiné : `finalScore = 0.4 * tagPreferenceScore + 0.6 * llmRelevanceScore`
- [ ] Tri par défaut de l'inbox par score décroissant → les articles importants remontent en haut
- [ ] Seuil configurable d'auto-archive (ex: score < 2 → suggestion d'archivage en batch)

**Attention au token budget** : Le profil utilisateur allonge le prompt d'entrée (~50 tokens). Négligeable sur Gemini Flash mais à surveiller si le nombre d'articles par run est élevé.

### 2.2 Clustering par tags (sans LLM)

| | |
|---|---|
| **Coût LLM** | Aucun pour le regroupement / 1 appel on-demand pour la synthèse |
| **Effort** | Moyen |

**Problème** : Quand un sujet est "chaud", 5-10 articles disent la même chose.

**Solution** :
- [ ] Regroupement déterministe : articles partageant >= 2 tags identiques dans le même run → même cluster
- [ ] Affichage dans le dashboard : les clusters apparaissent comme un "groupe" dépliable avec compteur ("3 articles sur IA générative")
- [ ] Action en batch sur le cluster : "Sauvegarder le meilleur + archiver le reste"
- [ ] **Optionnel** (1 appel LLM supplémentaire, on-demand uniquement) : bouton "Synthétiser ce groupe" pour un résumé unifié

### 2.3 Snooze d'article

| | |
|---|---|
| **Coût LLM** | Aucun |
| **Effort** | Moyen |

**Problème** : Articles intéressants mais pas urgents. Les garder dans l'inbox encombre la vue.

**Solution** :
- [ ] Champ `snoozedUntil?: string` (ISO date) sur le modèle Article
- [ ] Options de snooze : "Ce soir", "Demain matin", "Ce weekend", "Dans 1 semaine", date personnalisée
- [ ] Articles snoozés masqués de l'inbox, réapparition automatique à la date
- [ ] Vue "Snoozés" dans le dashboard pour consulter / annuler
- [ ] Notification Telegram optionnelle au retour du snooze

---

## Phase 3 — Recherche et lecture (coût maîtrisé)

### 3.1 Recherche full-text locale (alternative gratuite à la recherche sémantique)

| | |
|---|---|
| **Coût LLM** | Aucun |
| **Effort** | Moyen |

**Problème** : Retrouver un article lu il y a 2 semaines.

**Solution** :
- [ ] Index full-text sur titre + résumé + tags (côté client dans le dashboard, ou via SQLite/Lunr.js côté serveur)
- [ ] Barre de recherche dans le dashboard avec résultats instantanés
- [ ] Recherche dans les articles sauvegardés ET l'inbox
- [ ] Pas d'embedding, pas d'API, tout en local

**Évolution future** : Si un jour le budget le permet, ajouter une recherche sémantique par embeddings (~$0.0001/article via API, ou gratuit avec un modèle local type `all-MiniLM-L6-v2` via Transformers.js).

### 3.2 Table des matières pour articles longs

| | |
|---|---|
| **Coût LLM** | 1 appel on-demand (uniquement si l'utilisateur clique) |
| **Effort** | Faible |

**Problème** : Articles de fond (>1500 mots) difficiles à évaluer rapidement.

**Solution** :
- [ ] Bouton "Structure" visible uniquement sur les articles longs
- [ ] Génération on-demand : extraction des headings HTML existants (h2, h3) sans LLM si la structure existe déjà dans le HTML
- [ ] Fallback LLM uniquement si pas de headings dans le contenu original
- [ ] Cache du résultat en base pour ne jamais regénérer
- [ ] Panneau latéral cliquable pour naviguer

### 3.3 Focus Mode (Reader View)

| | |
|---|---|
| **Coût LLM** | Aucun |
| **Effort** | Faible |

**Problème** : Le contenu original reste parfois pollué même après nettoyage Readability.

**Solution** :
- [ ] Vue lecture épurée : fond neutre, typographie optimisée, largeur 65-75 caractères
- [ ] Bascule "résumé ↔ article complet" en un clic
- [ ] Estimation du temps de lecture (nombre de mots / 200)
- [ ] Mode sombre intégré (déjà supporté par le dashboard)

---

## Récapitulatif coûts

| Feature | Appels LLM supplémentaires | Notes |
|---|---|---|
| 1.1 Normalisation tags | 0 | Pure logique string |
| 1.2 Déduplication | 0 | Jaccard + URL |
| 1.3 Auto-archive bruit | 0 | Heuristiques — **économise** des appels en filtrant avant le LLM |
| 1.4 Raccourcis triage | 0 | Pure UI |
| 2.1 Score pertinence | 0 | Piggyback sur l'appel `enrich()` existant |
| 2.2 Clustering | 0 (regroupement) / 1 on-demand (synthèse) | Le regroupement est déterministe (tags communs) |
| 2.3 Snooze | 0 | Pure logique date |
| 3.1 Recherche full-text | 0 | Index local, pas d'embedding |
| 3.2 Table des matières | 0 ou 1 on-demand | Extraction HTML d'abord, LLM seulement en fallback |
| 3.3 Focus Mode | 0 | Pure UI/CSS |

**Bilan** : Sur 10 features, **8 sont à zéro coût LLM**. Les 2 restantes sont on-demand (l'utilisateur choisit explicitement de dépenser un appel).
