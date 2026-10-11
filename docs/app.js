import { WaveDetector, SharedPresence } from './gesture.js';
import { RoomTransport } from './transport.js';
import { createVisuals } from './visuals.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
// Every visitor to this installation joins the same space. No room setup needed.
const room = 'beyond-the-body-irissss1121-v2';
let role = 'A', active = false, mode = 'camera', pressed = false, pointerHeld = false;
let transport = null, stream = null, model = null, modelPromise = null, cameraRun = 0;
let local = idle(), remote = idle(), poseAt = -Infinity;
let presence = { connected: false, level: 0, mutual: false, progress: 0 };
let signalStatus = 'connecting', sameRoleAt = -Infinity, lastUI = 0, lastSend = 0;
let sketch;
const detector = new WaveDetector();
const shared = new SharedPresence();
function idle() { return { waving: false, energy: 0, handY: .55, hands: [] }; }
function showError(message) { $('setup-error').textContent = message; $('setup-error').hidden = false; }
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}
async function loadML5() {
  if (window.ml5) return;
  if (!window.__ml5Loading) window.__ml5Loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/ml5@1.3.1/dist/ml5.min.js';
    script.onload = resolve;
    script.onerror = () => { script.remove(); window.__ml5Loading = null; reject(new Error('The movement library could not load. Check your internet connection and try again.')); };
    document.head.append(script);
  });
  await window.__ml5Loading;
}
async function getModel() {
  if (!modelPromise) {
    // ml5's factory can return a Promise when loaded after a p5 instance.
    // Support both forms and share one model load across camera retries.
    modelPromise = Promise.resolve(ml5.bodyPose('MoveNet', {
      modelType: 'SINGLEPOSE_LIGHTNING', enableSmoothing: true
    })).then(async value => { await value.ready; return value; }).catch(error => { modelPromise = null; throw error; });
  }
  return withTimeout(modelPromise, 60000, 'The model is taking too long to load. Check your connection and try again.');
}
async function startCamera() {
  const run = ++cameraRun;
  $('loading').hidden = false; $('loading-text').textContent = 'Opening your camera…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Open the HTTPS website or use localhost to enable your camera.');
    const acquired = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
    if (run !== cameraRun) { acquired.getTracks().forEach(track => track.stop()); return false; }
    stream = acquired;
    const video = $('camera'); video.width = 640; video.height = 480; video.srcObject = stream;
    await withTimeout(video.play(), 10000, 'The camera could not start. Please try again.');
    if (run !== cameraRun) return false;
    $('loading-text').textContent = 'Loading movement tracking…';
    await withTimeout(loadML5(), 30000, 'The movement library could not load. Please check your connection.');
    if (run !== cameraRun) return false;
    const candidate = await getModel();
    if (run !== cameraRun) return false;
    model = candidate;
    detector.reset(); poseAt = -Infinity;
    model.detectStart(video, poses => {
      if (run !== cameraRun || !active || mode !== 'camera' || document.hidden) return;
      poseAt = performance.now();
      local = detector.update(poses[0] || null, video.width, video.height, poseAt);
    });
    return true;
  } catch (error) {
    if (run !== cameraRun) return false;
    $('loading').hidden = true; stopCamera();
    showError(error.name === 'NotAllowedError' ? 'Allow camera access in your browser, then choose your presence again.' : error.name === 'NotFoundError' ? 'No camera was found. You can try the connection without a camera.' : error.message);
    $('use-keyboard').hidden = false;
    return false;
  } finally { if (run === cameraRun) $('loading').hidden = true; }
}
function stopCamera() {
  ++cameraRun; model?.detectStop?.();
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  $('camera').srcObject = null; local = idle(); detector.reset();
}
async function enter(selectedRole, selectedMode = 'camera') {
  if (active || !$('loading').hidden || !sketch) return;
  role = selectedRole; mode = selectedMode; document.body.dataset.role = role;
  $('setup-error').hidden = true; $('use-keyboard').hidden = true;
  if (mode === 'camera' && !await startCamera()) return;
  active = true; local = idle(); remote = idle(); shared.reset();
  signalStatus = 'connecting'; sameRoleAt = -Infinity;
  $('welcome').hidden = true; $('session-hud').hidden = false; $('controls').hidden = false;
  document.body.classList.add('active');
  $('room-label').textContent = 'SHARED SPACE';
  $('self-name').textContent = role === 'A' ? 'A · PINK' : 'B · BLUE';
  $('other-name').textContent = role === 'A' ? 'B · BLUE' : 'A · PINK';
  $('self-dot').style.background = role === 'A' ? '#ff729e' : '#72b5ff';
  $('other-dot').style.background = role === 'A' ? '#72b5ff' : '#ff729e';
  $('wave-button').hidden = mode !== 'keyboard';
  $('gesture-guide').innerHTML = mode === 'camera' ? 'Raise one hand and wave from side to side.<br><span>Purple appears only when you both wave.</span>' : 'Hold Space or the button to simulate a wave.<br><span>Purple appears only when you both wave.</span>';
  transport = new RoomTransport(sketch, room, role, state => { remote = state; }, status => {
    if (status === 'same-role') sameRoleAt = performance.now(); else signalStatus = status;
  }, { webRTCOnly: params.get('transport') === 'webrtc' });
}
function leave() {
  active = false; pressed = false; pointerHeld = false;
  transport?.send(idle(), mode); transport?.close(); transport = null;
  stopCamera(); remote = idle(); shared.reset();
  presence = { connected: false, level: 0, mutual: false, progress: 0 };
  $('welcome').hidden = false; $('session-hud').hidden = true; $('controls').hidden = true;
  $('wave-button').hidden = true; $('loading').hidden = true; $('toast').hidden = true;
  document.body.classList.remove('active');
  $('room-label').textContent = 'TWO PARTICIPANTS'; $('network-dot').classList.remove('online');
}
function frame(now) {
  if (active) {
    if (mode === 'keyboard') {
      const waving = (pressed || pointerHeld) && !document.hidden;
      local = { waving, energy: waving ? .68 : 0, handY: .45,
        hands: waving ? [{ x: .5 + Math.sin(now / 160) * .16, y: .4 }] : [], updatedAt: now };
      $('wave-button').classList.toggle('active', waving);
    } else if (now - poseAt > 600 || document.hidden) { local = { ...idle(), updatedAt: now }; detector.reset(); }
    const online = Number.isFinite(remote.receivedAt) && now - remote.receivedAt < 900;
    if (!online) remote = idle();
    presence = shared.update(local, remote, now);
    if (now - lastSend >= 100) { transport?.send(local, mode); lastSend = now; }
    if (now - lastUI >= 120) { updateHUD(now, online); lastUI = now; }
  }
  requestAnimationFrame(frame);
}
function updateHUD(now, online) {
  $('network-dot').classList.toggle('online', online);
  $('self-status').textContent = local.waving ? 'Reaching out' : mode === 'camera' && !local.hands.length ? 'Keep your hands and shoulders in view' : mode === 'camera' ? 'Raise a hand and wave' : 'Hold Space to wave';
  $('other-status').textContent = online ? remote.waving ? 'Reaching toward you' : 'Present, waiting for movement' : 'Waiting to join';
  $('self-dot').classList.toggle('active', local.waving); $('other-dot').classList.toggle('active', online && remote.waving);
  let phase, title, caption;
  if (presence.connected) [phase, title, caption] = ['04 / CONNECTION', 'A presence made by both of you.', 'Connected. Your movements are becoming one.'];
  else if (presence.mutual) [phase, title, caption] = ['03 / RESPONSE', 'You are answering each other.', 'Keep waving together.'];
  else if (presence.level > .03) [phase, title, caption] = ['05 / DISAPPEARANCE', 'The movement stops. The light remains.', 'Your shared presence is slowly fading.'];
  else if (online && (local.waving || remote.waving)) [phase, title, caption] = ['02 / REACHING OUT', 'A signal crosses the space.', local.waving ? 'You are reaching out. Wait for a wave in return.' : 'They are reaching out. Wave back.'];
  else [phase, title, caption] = ['01 / SEPARATION', 'Reach across the space.', online ? 'You are both here. Try waving together.' : now - sameRoleAt < 2500 ? 'You chose the same color. One of you should change presence.' : signalStatus === 'error' ? 'Connection unavailable. Check your internet, then rejoin.' : 'Your friend can open this same link and choose ' + (role === 'A' ? 'B.' : 'A.')];
  $('phase-label').textContent = phase; $('phase-title').textContent = title; $('phase-caption').textContent = caption;
  $('connection-progress').style.width = `${Math.max(presence.progress, presence.level) * 100}%`;
}
$('join-a').addEventListener('click', () => enter('A', params.get('input') === 'keyboard' ? 'keyboard' : 'camera'));
$('join-b').addEventListener('click', () => enter('B', params.get('input') === 'keyboard' ? 'keyboard' : 'camera'));
$('use-keyboard').addEventListener('click', () => enter(role, 'keyboard'));
$('cancel-loading').addEventListener('click', () => { stopCamera(); $('loading').hidden = true; });
$('leave').addEventListener('click', leave);
document.addEventListener('keydown', event => {
  if (event.code === 'Space' && active && mode === 'keyboard' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); pressed = true; }
});
document.addEventListener('keyup', event => { if (event.code === 'Space') pressed = false; });
window.addEventListener('blur', () => { pressed = false; pointerHeld = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pressed = false; pointerHeld = false; local = idle(); detector.reset(); transport?.send(local, mode); }
});
$('wave-button').addEventListener('pointerdown', event => { event.preventDefault(); pointerHeld = true; $('wave-button').setPointerCapture(event.pointerId); });
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('wave-button').addEventListener(event, () => { pointerHeld = false; });
window.addEventListener('pagehide', () => { transport?.close(); stopCamera(); });
window.addEventListener('pageshow', event => { if (event.persisted) leave(); });
function boot() {
  if (typeof p5 === 'undefined') { showError('The visual library could not load. Check your connection and refresh.'); return; }
  sketch = createVisuals($('stage'), () => ({ active, role, local, remote,
    online: Number.isFinite(remote.receivedAt) && performance.now() - remote.receivedAt < 900,
    presence, now: performance.now() }));
  requestAnimationFrame(frame);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
