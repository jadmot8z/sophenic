'use strict';
const $ = id => document.getElementById(id);
let token = '', active = null, after = 0, confirmation = null, screenshotURL = null, busy = false, pendingId = null, permissionMode = 'sensitive', permissionSaving = false, browserSaving = false;
async function api(path, method = 'GET', body) {
  const response = await fetch('/api' + path, {method, headers: {'Content-Type': 'application/json', 'X-Agent-Token': token}, body: body === undefined ? undefined : JSON.stringify(body)});
  if (!response.ok) { let detail; try { detail = (await response.json()).detail; } catch { detail = response.statusText; } throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)); }
  return response.json();
}
function notice(error) { $('notice').textContent = error.message || String(error); }
function bubble(text, type = '') { const el = document.createElement('div'); el.className = 'bubble ' + type; el.textContent = text; $('conversation').append(el); el.scrollIntoView({block:'nearest'}); }
async function history() {
  const tasks = await api('/tasks'); $('history').replaceChildren();
  tasks.forEach(task => { const b = document.createElement('button'); b.textContent = task.goal.slice(0,75) + ' · ' + task.status; b.onclick = () => select(task); $('history').append(b); });
}
function select(task) { active = task.id; after = 0; $('conversation').replaceChildren(); $('logs').replaceChildren(); bubble(task.goal, 'user'); }
async function poll() {
  try {
    const state = await api('/state'); busy = state.busy;
    if (!permissionSaving) showPermissions(state.permission_mode);
    $('app-version').textContent = 'LOCAL WORKSPACE · v' + state.version;
    const browser = state.browser;
    if (browser) $('browser-status').textContent = (browser.running ? '● Ouvert · ' : '○ Fermé · ') +
      browser.channel + (browser.remember_session ? ' · Profil conservé' : ' · Session temporaire') +
      (browser.last_recovery ? ' — ' + browser.last_recovery : '');
    $('save-browser').disabled = busy || browserSaving;
    $('open-browser').disabled = busy || browserSaving;
    $('browser-channel').disabled = busy || browserSaving;
    $('remember-session').disabled = busy || browserSaving;
    $('phase').textContent = state.phase; $('stop').disabled = !busy; $('start').disabled = busy;
    confirmation = state.confirmation;
    $('approval').hidden = !confirmation;
    if (confirmation) {
      const human = confirmation.kind === 'intervention';
      if (pendingId !== confirmation.id) {
        $('human-response').value = '';
        pendingId = confirmation.id;
        $('approval').scrollIntoView({block: 'nearest'});
      }
      $('approval-title').textContent = human ? 'Votre intervention est nécessaire' : 'Confirmer cette action';
      $('approval-detail').textContent = human ? confirmation.message :
        [confirmation.message, confirmation.summary, JSON.stringify(confirmation.action, null, 2),
         'Cible : ' + JSON.stringify(confirmation.element), 'Page : ' + confirmation.page_url].filter(Boolean).join('\n\n');
      $('human-response-label').hidden = !human;
      $('approval-hint').textContent = human ?
        'Répondez à la question ci-dessous ou réalisez l’étape demandée dans le navigateur piloté. L’agent attend sans agir. Ne saisissez jamais de mot de passe ici.' :
        'Vérifiez destinataire, contenu, montant et effet dans le navigateur piloté avant d’autoriser.';
      $('approve').textContent = human ? 'J’ai terminé — Reprendre' : 'Autoriser cette action';
      $('reject').textContent = human ? 'Annuler la tâche' : 'Refuser et arrêter';
    }
    $('empty-preview').textContent = state.tabs.length ?
      'Le navigateur est ouvert. Cliquez sur Actualiser la capture pour voir l’onglet actif.' :
      'Chromium s’ouvrira au démarrage de la première tâche.';
    $('tabs').replaceChildren();
    state.tabs.forEach(tab => { const item = document.createElement('div'); item.textContent = `${tab.active ? '●' : '○'} ${tab.id} · ${tab.url}`; $('tabs').append(item); });
    if (active) {
      const events = await api(`/tasks/${active}/events?after=${after}`);
      for (const event of events) {
        after = event.id;
        const log = document.createElement('div'); log.textContent = `${new Date(event.at).toLocaleTimeString()} · ${event.kind}\n${JSON.stringify(event.payload)}`; $('logs').append(log);
        if ($('logs').children.length > 200) $('logs').firstChild.remove();
        if (event.kind === 'plan') bubble(event.payload.steps.map((s,i)=>`${i+1}. ${s}`).join('\n'), 'plan');
        if (event.kind === 'answer') bubble(event.payload.text);
        if (event.kind === 'error' || event.kind === 'attention' || event.kind === 'recovery') bubble(event.payload.message);
        if (event.kind === 'cancelled') bubble(event.payload.reason || 'Tâche arrêtée.');
      }
      if (events.length) await history();
    }
  } catch (error) { notice(error); }
  finally { setTimeout(poll, 1200); }
}
$('chat').onsubmit = async event => {
  event.preventDefault(); $('notice').textContent = ''; $('start').disabled = true;
  try { const goal = $('goal').value.trim(); const result = await api('/tasks','POST',{goal}); select({id:result.id,goal}); $('goal').value = ''; await history(); }
  catch(error) { notice(error); $('start').disabled = busy; }
};
$('stop').onclick = async () => { try { await api('/stop','POST'); } catch(error) { notice(error); } };
$('new').onclick = () => { active = null; after = 0; $('conversation').replaceChildren(); $('logs').replaceChildren(); $('goal').focus(); };
$('example').onclick = () => { $('goal').value = 'Trouve-moi les meilleurs ordinateurs portables RTX 4070 à moins de 1500 euros. Compare les prix, caractéristiques et donne les sources.'; $('goal').focus(); };
async function respondToRequest(approved) { if (!confirmation) return; try { await api('/confirm/' + confirmation.id,'POST',{approved,response: confirmation.kind === 'intervention' ? $('human-response').value : ''}); $('approval').hidden = true; confirmation = null; } catch(error) { notice(error); } }
$('approve').onclick = () => respondToRequest(true); $('reject').onclick = () => respondToRequest(false);
$('capture').onclick = async () => {
  try { const res = await fetch('/api/screenshot'); if(!res.ok) throw new Error('Capture indisponible : démarrez une tâche.'); const blob = await res.blob(); if(screenshotURL) URL.revokeObjectURL(screenshotURL); screenshotURL = URL.createObjectURL(blob); $('screenshot').src = screenshotURL; $('screenshot').hidden = false; $('empty-preview').hidden = true; } catch(error) { notice(error); }
};
$('preferences').onsubmit = async event => { event.preventDefault(); try { await api('/preferences/instructions','PUT',{value:$('preference').value}); } catch(error) { notice(error); } };
function showPermissions(mode) {
  permissionMode = mode || 'sensitive';
  const labels = {always_ask:'Toujours demander',sensitive:'Actions sensibles uniquement',always_accept:'Toujours accepter'};
  document.querySelectorAll('[data-permission]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.permission === permissionMode));
    button.disabled = permissionSaving;
  });
  $('permission-badge').textContent = '● ' + labels[permissionMode];
  $('permission-risk').hidden = permissionMode !== 'always_accept';
  $('permission-description').textContent = permissionMode === 'always_ask' ?
    'Confirmation avant chaque action navigateur, hors observation. Les décisions du modèle restent automatiques.' :
    permissionMode === 'always_accept' ? 'Mode sans confirmations d’action — restez attentif au navigateur.' :
    'Confirmation avant les actions sensibles détectées ; navigation et recherche automatiques.';
}
document.querySelectorAll('[data-permission]').forEach(button => {
  button.onclick = async () => {
    const mode = button.dataset.permission;
    if (permissionSaving || mode === permissionMode) return;
    if (mode === 'always_accept' && !window.confirm('Toujours accepter autorise aussi les envois de messages, achats, suppressions, publications et uploads sans confirmation. Activer ce mode ?')) return;
    permissionSaving = true;
    showPermissions(permissionMode);
    try {
      const result = await api('/settings/permissions','PUT',{mode,accept_sensitive_risk:mode === 'always_accept'});
      permissionMode = result.mode;
      if (confirmation) $('notice').textContent = 'Mode changé pour les prochaines actions. La demande déjà affichée reste à traiter.';
    } catch(error) { notice(error); }
    finally { permissionSaving = false; showPermissions(permissionMode); }
  };
});
function showBrowserSettings(settings) {
  $('browser-channel').value = settings.channel;
  $('remember-session').checked = settings.remember_session;
}
$('browser-settings').onsubmit = async event => {
  event.preventDefault();
  if (busy || browserSaving) return;
  browserSaving = true;
  $('save-browser').disabled = true;
  try {
    const settings = await api('/settings/browser','PUT',{
      channel:$('browser-channel').value,remember_session:$('remember-session').checked});
    showBrowserSettings(settings);
    $('notice').textContent = 'Navigateur configuré. Cliquez sur Ouvrir le navigateur. Ce réglage ne garantit pas l’acceptation de la connexion par le site.';
  } catch(error) { notice(error); }
  finally { browserSaving = false; $('save-browser').disabled = busy; }
};
$('open-browser').onclick = async () => {
  if (busy || browserSaving) return;
  browserSaving = true;
  $('open-browser').disabled = true;
  try { showBrowserSettings(await api('/browser/open','POST')); }
  catch(error) { notice(error); }
  finally { browserSaving = false; $('open-browser').disabled = busy; }
};
async function init() {
  try {
    token = (await api('/session')).token;
    const version = await api('/version');
    $('app-version').textContent = 'LOCAL WORKSPACE · v' + version.version;
    if (version.version !== '1.3.1') notice(new Error('Interface 1.3.1 / backend ' + version.version + ' : fermez l’ancienne console, relancez depuis le dossier mis à jour et faites Ctrl+F5.'));
    showBrowserSettings(await api('/settings/browser'));
    showPermissions((await api('/settings/permissions')).mode);
    await history();
    const state = await api('/state');
    if (state.task_id) { const tasks = await api('/tasks'); const task = tasks.find(t=>t.id===state.task_id); if(task) select(task); }
    $('preference').value = (await api('/preferences')).instructions || '';
    $('files').textContent = (await api('/files')).join(', ') || 'Aucun fichier';
    poll();
    const health = await api('/health'); $('health').textContent = health.ollama.available ? '● Ollama connecté' : '○ Ollama / Qwen3 indisponible';
  } catch(error) { notice(error); }
}
init();
