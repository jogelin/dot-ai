---
name: model-routing
description: Smart model selection for sub-agents and main session. Cost optimization, rate limit awareness.
triggers: [always]
---

# Model Routing

Règles de sélection automatique de modèle. Ce skill DOIT être consulté avant chaque `sessions_spawn` et chaque décision de switch de modèle en session principale.

## Modèles disponibles

| Alias | Model ID | Coût relatif | Context | Reasoning |
|-------|----------|-------------|---------|-----------|
| **opus** | `anthropic/claude-opus-4-6` | $$$$$ | 1M | ✅ |
| **sonnet** | `anthropic/claude-sonnet-4` | $$ | 200K | ✅ |
| **haiku** | `anthropic/claude-haiku` | $ | 200K | ❌ |

## Règles de sélection — Sub-agents (`sessions_spawn`)

### Haiku (défaut pour exécution)
- OCR, extraction de données
- Audit, vérification, bulk ops
- Scraping, collecte d'info
- Lecture/résumé de fichiers
- Mise à jour de fichiers (BACKLOG, indexes)
- Formatage, reports HTML
- Toute tâche avec instructions claires et peu d'ambiguïté

### Sonnet (dev standard)
- Développement, refactoring, code review
- Recherche web extensive (multiple URLs)
- Analyse et synthèse de contenu
- Rédaction d'articles/documentation
- Exploration de codebase

### Opus (raisonnement complexe)
- Planification, architecture, décisions stratégiques
- Problèmes ambigus nécessitant du jugement
- Peer review de code complexe
- **NE JAMAIS spawner un sub-agent Opus sauf si explicitement demandé**

## Règles de sélection — Session principale

### Quand rester en Opus
- Conversation directe avec Jo (décisions, planification)
- Raisonnement complexe, multi-étapes
- Première discussion sur un nouveau sujet

### Quand switcher vers Sonnet
- Phase d'exploration/recherche (web_fetch multiples)
- Édition de fichiers, mise à jour docs
- Conversation casual, Q&A rapide
- Brainstorming (Opus = overkill)
- **Switcher proactivement** — ne pas attendre que Jo le remarque

### Quand switcher vers Haiku
- Heartbeat checks (déjà configuré dans OpenClaw)
- Tâches mécaniques répétitives

## Rate Limit Awareness

### Règles de protection
- Max 8 sub-agents concurrents (configuré dans OpenClaw)
- Si > 4 sub-agents actifs : utiliser Haiku pour les nouveaux (même si Sonnet serait mieux)
- Si rate limit hit : basculer immédiatement vers le tier inférieur
- Espacer les spawns de sub-agents de 2-3 secondes minimum

### Anti-patterns
- ❌ Ne JAMAIS spawner 5+ sub-agents Opus en parallèle
- ❌ Ne JAMAIS faire de web_fetch multiples dans le contexte principal en Opus
- ❌ Ne JAMAIS utiliser Opus pour un sub-agent de collecte/extraction
- ❌ Ne JAMAIS oublier de spécifier le modèle dans `sessions_spawn`

## Context Budget

### Seuils de vigilance
- **< 50% contexte** : fonctionnement normal
- **50-70% contexte** : envisager de déléguer les lectures à des sub-agents
- **> 70% contexte** : switcher vers Sonnet si en Opus, déléguer agressivement
- **> 85% contexte** : ne plus lire de fichiers, travailler uniquement avec ce qui est en mémoire

## Tracking

À chaque `sessions_spawn`, mentalement vérifier :
1. ✅ Modèle spécifié ? (ne pas laisser le défaut Opus)
2. ✅ Modèle approprié au type de tâche ?
3. ✅ Nombre de sub-agents actifs OK ?
4. ✅ Le contexte principal est-il préservé ?
