export type SophenicIntent = "chat" | "code" | "agent_pc" | "research" | "project";

export type IntentDecision = {
  intent: SophenicIntent;
  label: string;
  requiresHermes: boolean;
  purpose: "assistant" | "code" | "pc";
  confidence: number;
  reason: string;
};

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const IMAGE_REQUEST = /\b(image|photo|illustration|logo|affiche|poster|visuel|portrait)\b/;
const PROJECT_TARGET = /\b(site(?: web)?|application|app|logiciel|dashboard|saas|landing page|ecommerce|e-commerce|projet|api|backend|frontend|extension|bot|jeu|game)\b/;
const CODE_TARGET = /\b(code|script|html|css|javascript|typescript|react|next(?:js)?|vite|node|npm|python|flutter|dart|swift|java|kotlin|sql|bug|erreur|build|compile|test|app\.tsx|fichier source)\b/;
const BUILD_VERB = /\b(cree|creer|construis|construire|developpe|developper|programme|programmer|code|coder|implemente|implementer|genere|generer|fais|fabrique|modifie|modifier|corrige|corriger|repare|reparer|debug|teste|tester|compile|compiler|build|ecris|ecrire|ajoute|ajouter)\b/;
const IDEATION = /\b(idee(?:s)?|idee generale|concept|brainstorm(?:ing)?|imagine|imaginer|invente|inventer|pourrais[- ]?je creer|pourrait[- ]?on creer|que puis[- ]?je creer|quel(?:le)? (?:site|application|app|saas|projet)|conception|reflexion|piste(?:s)?|suggestion(?:s)?)\b/;
const META_PROMPT = /\b(?:donne(?:r)?|ecris|redige|cree|genere|fais)\s+(?:moi\s+)?(?:un|le|ce)\s+prompt\b|\bprompt\s+(?:pour|a donner a|que je donnerai a)\b|\b(?:pour chatgpt|pour claude|pour gemini|pour une ia)\b/;
const CODE_DISCUSSION = /\b(?:explique|expliquer|comprends|comprendre|analyse|analyser|review|revue|avis|conseil|comment fonctionne|quelle architecture|quel framework|meilleur langage|difference entre|compare)\b[\s\S]{0,120}\b(?:code|script|typescript|javascript|python|react|next|electron|api|projet|application|site)\b|\b(?:que fait|a quoi sert)\b[\s\S]{0,80}\b(?:ce code|ce script|cette fonction|ce fichier)\b/;
const IMPLEMENTATION_CONTEXT = /\b(dans (?:mon|le|ce) dossier|dans (?:mon|le) projet|dans (?:mon|le) repo|repository|depot|workspace|fichier(?: source)?|app\.tsx|src\/|terminal|npm|build|compile|ecris le code|genere les fichiers|cree les fichiers|ajoute (?:cette|la|une) fonctionnalite|modifie[\s\S]{0,32}(?:fichier|code|projet|app\.tsx)|corrige[\s\S]{0,32}(?:bug|erreur|code|projet|app\.tsx)|repare[\s\S]{0,32}(?:bug|erreur|code|projet)|implemente[\s\S]{0,32}(?:fonctionnalite|code|projet))\b/;
const PC_VERB = /\b(ouvre|ouvrir|lance|lancer|demarre|demarrer|ferme|fermer|quitte|quitter|arrete|arreter|installe|installer|desinstalle|desinstaller|clique|cliquer|tape|colle|copie|deplace|renomme|supprime|telecharge|execute|executer)\b/;
const PC_TARGET = /\b(chrome|edge|firefox|youtube|navigateur|terminal|powershell|cmd|windows|bureau|telechargements|fenetre|application|logiciel|programme|spotify|discord|whatsapp|calculatrice|bloc notes|notepad|explorateur|fichier|dossier|ordinateur|pc)\b/;
const FILESYSTEM_ACTION = /\b(?:cree|creer|ouvre|ouvrir|affiche)\b[\s\S]{0,50}\b(?:fichier|dossier|bureau|telechargements?|downloads?)\b/;
const LOCAL_SYSTEM_ACTION = /(?:\b(?:quel(?:le)? est mon volume|volume actuel|mon volume|monte le volume|baisse le volume|coupe le son|remets le son)\b|\b(?:mets? pause|pause la musique|reprends? la musique|chanson suivante|chanson precedente)\b|\b(?:quelle heure|quelle date|quel jour)\b|\b(?:mets?|joue|lance)\b[\s\S]{1,80}\bspotify\b)/;
const RESEARCH_VERB = /\b(recherche|rechercher|cherche|chercher|trouve|trouver|compare|comparer|verifie|verifier|analyse|analyser)\b/;
const RESEARCH_TARGET = /\b(web|internet|en ligne|site|sources?|actualite|actuel|aujourd'hui|aujourdhui|latest|recent|prix|avis|documentation|docs|marche|concurrents?)\b/;

export function routeIntent(prompt: string): IntentDecision {
  const p = normalize(prompt);
  if (!p) return { intent: "chat", label: "Chat", requiresHermes: false, purpose: "assistant", confidence: 1, reason: "message vide" };

  // Deterministic local actions have priority over Chat/Code. The renderer's
  // src/actions/router.ts executes these directly; this branch is the safe IPC
  // fallback classification and must never classify simple files/folders as Code.
  if ((FILESYSTEM_ACTION.test(p) && !PROJECT_TARGET.test(p)) || LOCAL_SYSTEM_ACTION.test(p)) {
    return { intent: "agent_pc", label: "Action Windows", requiresHermes: false, purpose: "pc", confidence: 0.995, reason: "action locale déterministe" };
  }

  // A creative request is not an implementation request. Words such as
  // "créer", "site", "application" and "projet" are insufficient on their
  // own to enter Code when the user is asking for an idea, concept or design.
  if (IDEATION.test(p) && (PROJECT_TARGET.test(p) || BUILD_VERB.test(p))) {
    return { intent: "chat", label: "Chat · réflexion", requiresHermes: false, purpose: "assistant", confidence: 0.99, reason: "idéation/conception sans exécution demandée" };
  }

  // A request ABOUT code or asking for a reusable prompt remains conversational.
  // Only an explicit request to create/modify files should enter Sophenic Code.
  if (META_PROMPT.test(p)) {
    return { intent: "chat", label: "Chat · prompt", requiresHermes: false, purpose: "assistant", confidence: 0.995, reason: "demande de prompt/contenu, pas d’exécution de code" };
  }
  if (CODE_DISCUSSION.test(p) && !IMPLEMENTATION_CONTEXT.test(p)) {
    return { intent: "chat", label: "Chat · question code", requiresHermes: false, purpose: "assistant", confidence: 0.98, reason: "question ou explication sur le code sans modification du workspace" };
  }

  // Keep dedicated image generation in the Image product surface instead of
  // accidentally treating "crée une image" as a filesystem project request.
  if (IMAGE_REQUEST.test(p) && /\b(cree|genere|fais|dessine|produis)\b/.test(p)) {
    return { intent: "chat", label: "Chat", requiresHermes: false, purpose: "assistant", confidence: 0.74, reason: "demande créative sans action PC explicite" };
  }

  if (PC_VERB.test(p) && PC_TARGET.test(p) && !PROJECT_TARGET.test(p)) {
    return { intent: "agent_pc", label: "Agent PC", requiresHermes: true, purpose: "pc", confidence: 0.98, reason: "action locale explicite" };
  }

  if (BUILD_VERB.test(p) && PROJECT_TARGET.test(p)) {
    const explicitImplementation = IMPLEMENTATION_CONTEXT.test(p) || /\b(cree|construis|developpe|programme|code|implemente|genere|fabrique)\b/.test(p);
    if (explicitImplementation) {
      return { intent: "project", label: "Création projet", requiresHermes: false, purpose: "code", confidence: IMPLEMENTATION_CONTEXT.test(p) ? 0.995 : 0.9, reason: "implémentation de projet demandée" };
    }
  }

  if (BUILD_VERB.test(p) && (CODE_TARGET.test(p) || IMPLEMENTATION_CONTEXT.test(p))) {
    return { intent: "code", label: "Code", requiresHermes: false, purpose: "code", confidence: 0.97, reason: "modification ou génération de code explicite" };
  }

  if (RESEARCH_VERB.test(p) && (RESEARCH_TARGET.test(p) || /\b(source|lien|url)\b/.test(p))) {
    return { intent: "research", label: "Recherche", requiresHermes: false, purpose: "assistant", confidence: 0.91, reason: "recherche externe demandée" };
  }

  // Operational verbs are allowed to enter Agent mode even with an ambiguous
  // target; Hermes can then ask one concise clarification. Creative verbs are
  // deliberately excluded from this fallback.
  if (PC_VERB.test(p)) {
    return { intent: "agent_pc", label: "Agent", requiresHermes: true, purpose: "pc", confidence: 0.78, reason: "verbe d’action opérationnelle détecté" };
  }

  // Ambiguous creation/modification wording stays conversational. Code is only
  // selected when the target/context above proves an implementation intent.
  return { intent: "chat", label: "Chat", requiresHermes: false, purpose: "assistant", confidence: 0.99, reason: "conversation ou réflexion sans exécution explicite" };
}
