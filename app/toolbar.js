const $ = (s) => document.querySelector(s);
let state = { micEnabled: true, cameraEnabled: true, screenEnabled: false, activeScreenSharer: null, timerVisible: false, timerText: '', timerCritical: false };
let annotationActive = false;

function render(next = {}) {
  state = { ...state, ...next };
  $('#micBtn').classList.toggle('off', !state.micEnabled);
  $('#micBtn span').textContent = state.micEnabled ? '🎤' : '🔇';
  $('#camBtn').classList.toggle('off', !state.cameraEnabled);
  $('#camBtn span').textContent = state.cameraEnabled ? '🎥' : '🚫';
  const participantSharing = state.activeScreenSharer === 'student';
  $('#shareBtn').classList.toggle('active', state.screenEnabled);
  $('#shareBtn').disabled = participantSharing;
  $('#shareBtn span').textContent = state.screenEnabled ? '🟢' : '🖥️';
  $('#shareBtn small').textContent = state.screenEnabled ? 'Paylaşımı Durdur' : (participantSharing ? 'Katılımcı Paylaşıyor' : 'Ekranı Paylaş');
  $('#drawBtn').disabled = !state.screenEnabled;
  $('#drawBtn').classList.toggle('active', annotationActive);
  $('#toolbarTimer').classList.toggle('hidden', !state.timerVisible);
  $('#toolbarTimer').classList.toggle('critical', Boolean(state.timerCritical));
  if (state.timerText) $('#toolbarTimerText').textContent = state.timerText;
}

$('#micBtn').addEventListener('click', () => window.miniMeet.toolbarCommand('toggle-mic'));
$('#camBtn').addEventListener('click', () => window.miniMeet.toolbarCommand('toggle-camera'));
$('#devicesBtn').addEventListener('click', () => window.miniMeet.toolbarCommand('open-devices'));
$('#shareBtn').addEventListener('click', () => window.miniMeet.toolbarCommand('toggle-screen'));
$('#drawBtn').addEventListener('click', () => { if (state.screenEnabled) window.miniMeet.toolbarCommand('toggle-annotation'); });
$('#linkBtn').addEventListener('click', () => window.miniMeet.toolbarCommand('copy-link'));
$('#endBtn').addEventListener('click', () => window.miniMeet.toolbarCommand('end-lesson'));
window.miniMeet.onToolbarState(render);
window.miniMeet.onAnnotationState((next) => {
  annotationActive = Boolean(next?.active);
  $('#drawBtn').classList.toggle('active', annotationActive);
  $('#drawBtn small').textContent = annotationActive ? 'Çizimi Kapat' : 'Çizim';
});
render();
