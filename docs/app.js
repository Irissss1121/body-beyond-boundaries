import { SharedPresence } from './gesture.js?v=2';
import { FrameMotionDetector } from './motion.js?v=2';
import { RoomTransport } from './transport.js';
import { createVisuals } from './visuals.js?v=2';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const room = 'beyond-the-body-irissss1121-v2';
let role = 'A', active = false, mode = 'camera', pressed = false, pointerHeld = false;
let demo = false, demoStarted = 0, transport = null, stream = null, cameraRun = 0;
let local = idle(), remote = idle(), movementAt = -Infinity, movementFrames = 0, trackingError = '';
let presence = { connected: false, level: 0, mutual: false, progress: 0 };
let signalStatus = 'connecting', sameRoleAt = -Infinity, lastUI = 0, lastSend = 0;
let sketch;
const shared = new SharedPresence();
const motionDetector = new FrameMotionDetector({ width: 80, height: 60 });
const motionCanvas = document.createElement('canvas'); motionCanvas.width = 80; motionCanvas.height = 60;
const motionContext = motionCanvas.getContext('2d', { willReadFrequently: true });
function idle() { return { waving: false, moving: false, energy: 0, handY: .55, hands: [] }; }
function showError(message) { $('setup-error').textContent = message; $('setup-error').hidden = false; }
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
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
    $('preview').hidden = false;
    await withTimeout(video.play(), 10000, 'The camera could not start. Please try again.');
    if (run !== cameraRun) return false;
    motionDetector.reset(); movementAt = -Infinity; movementFrames = 0; trackingError = '';
    return true;
  } catch (error) {
    if (run !== cameraRun) return false;
    $('loading').hidden = true; stopCamera();
    showError(error.name === 'NotAllowedError' ? 'Allow camera access in your browser, then choose your presence again.' : error.name === 'NotFoundError' ? 'No camera was found. Try the demo or the connection without a camera.' : error.message);
    $('use-keyboard').hidden = false;
    return false;
  } finally { if (run === cameraRun) $('loading').hidden = true; }
}
function stopCamera() {
  ++cameraRun; stream?.getTracks().forEach(track => track.stop()); stream = null;
  $('camera').srcObject = null; $('preview').hidden = true; local = idle(); motionDetector.reset();
}
function sampleMovement(now) {
  if (document.hidden) { local = idle(); motionDetector.reset(); return; }
  if (now - movementAt < 65) return;
  const video = $('camera');
  if (video.readyState < 2 || !video.videoWidth) { local = idle(); return; }
  try {
    motionContext.drawImage(video, 0, 0, 80, 60);
    const movement = motionDetector.update(motionContext.getImageData(0, 0, 80, 60).data, now);
    // Keep the existing small packet schema: "waving" now means moving.
    local = { ...movement, waving: movement.moving, hands: [] };
    movementAt = now; movementFrames++; trackingError = '';
    drawMovement(movement);
  } catch (error) {
    local = idle(); movementAt = now; trackingError = 'Camera paused. Change presence to retry.';
    console.warn('Camera movement detection failed', error);
  }
}
function drawMovement(movement) {
  const canvas = $('pose-overlay'), ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (movement.moving) {
    ctx.fillStyle = role === 'A' ? '#ff729e' : '#72b5ff';
    ctx.globalAlpha = .45 + movement.energy * .4;
    ctx.beginPath(); ctx.arc(320, movement.handY * 480, 10 + movement.energy * 12, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = 1;
  }
}
function setParticipantLabels() {
  $('self-name').textContent = role === 'A' ? 'A · PINK' : 'B · BLUE';
  $('other-name').textContent = role === 'A' ? 'B · BLUE' : 'A · PINK';
  $('self-dot').style.background = role === 'A' ? '#ff729e' : '#72b5ff';
  $('other-dot').style.background = role === 'A' ? '#72b5ff' : '#ff729e';
}
async function enter(selectedRole, selectedMode = 'camera') {
  if (active || !$('loading').hidden || !sketch) return;
  role = selectedRole; mode = selectedMode; demo = false; document.body.dataset.role = role;
  $('setup-error').hidden = true; $('use-keyboard').hidden = true;
  if (mode === 'camera' && !await startCamera()) return;
  active = true; local = idle(); remote = idle(); shared.reset(); signalStatus = 'connecting'; sameRoleAt = -Infinity;
  $('welcome').hidden = true; $('session-hud').hidden = false; $('controls').hidden = false; document.body.classList.add('active');
  $('room-label').textContent = 'SHARED SPACE'; setParticipantLabels();
  $('wave-button').hidden = mode !== 'keyboard'; $('preview').hidden = mode !== 'camera'; $('demo-toggle').textContent = 'Demo';
  $('gesture-guide').innerHTML = mode === 'camera' ? 'Move your hands, arms, or upper body.<br><span>Purple appears when you both move at the same time.</span>' : 'Hold Space or the button to simulate movement.<br><span>Purple appears when you both move at the same time.</span>';
  transport = new RoomTransport(sketch, room, role, state => { remote = state; }, status => {
    if (status === 'same-role') sameRoleAt = performance.now(); else signalStatus = status;
  }, { webRTCOnly: params.get('transport') === 'webrtc' });
}
function leave() {
  active = false; demo = false; pressed = false; pointerHeld = false;
  transport?.send(idle(), mode); transport?.close(); transport = null; stopCamera(); remote = idle(); shared.reset();
  presence = { connected: false, level: 0, mutual: false, progress: 0 };
  $('welcome').hidden = false; $('session-hud').hidden = true; $('controls').hidden = true;
  $('wave-button').hidden = true; $('loading').hidden = true; $('toast').hidden = true; document.body.classList.remove('active');
  $('room-label').textContent = 'TWO PARTICIPANTS'; $('network-dot').classList.remove('online');
}
function enterDemo() {
  if (!sketch) return;
  // Simulated movement never enters the real shared room.
  leave(); demo = true; active = true; mode = 'demo'; demoStarted = performance.now();
  $('welcome').hidden = true; $('session-hud').hidden = false; $('controls').hidden = false; document.body.classList.add('active');
  $('room-label').textContent = 'DEMO · SIMULATED'; setParticipantLabels(); $('demo-toggle').textContent = 'Live mode';
  $('gesture-guide').innerHTML = 'Demo: one person moves → shared purple → fade.<br><span>Both participants are simulated. No camera or connection is needed.</span>';
}
function simulatedPerson(moving, now, offset = 0) {
  return { waving: moving, moving, energy: moving ? .82 : 0, handY: .44 + Math.sin(now / 1600 + offset) * .16,
    hands: [], updatedAt: now, receivedAt: now };
}
function frame(now) {
  if (active) {
    if (demo) {
      const seconds = (now - demoStarted) / 1000 % 16;
      local = simulatedPerson(seconds >= 2 && seconds < 10, now);
      remote = simulatedPerson(seconds >= 5 && seconds < 10 || seconds >= 13, now, 2);
    } else if (mode === 'keyboard') {
      const moving = (pressed || pointerHeld) && !document.hidden;
      local = { ...simulatedPerson(moving, now), energy: moving ? .68 : 0 };
      $('wave-button').classList.toggle('active', moving);
    } else sampleMovement(now);
    const online = Number.isFinite(remote.receivedAt) && now - remote.receivedAt < 900;
    if (!online) remote = idle();
    presence = shared.update(local, remote, now);
    if (now - lastSend >= 100) { transport?.send(local, mode); lastSend = now; }
    if (now - lastUI >= 120) { updateHUD(now, online); lastUI = now; }
  }
  requestAnimationFrame(frame);
}
function updateHUD(now, online) {
  $('network-dot').classList.toggle('online', online && !demo);
  $('self-status').textContent = demo ? local.waving ? 'Simulated movement' : 'Simulated presence' : trackingError && mode === 'camera' ? 'Camera paused' : local.waving ? 'Movement detected' : mode === 'camera' ? movementFrames ? 'Camera ready · Try moving' : 'Starting movement detection…' : 'Hold Space to move';
  $('other-status').textContent = demo ? remote.waving ? 'Simulated movement' : 'Simulated presence' : online ? remote.waving ? 'Movement detected' : 'Present, waiting for movement' : 'Waiting to join';
  if (mode === 'camera') $('tracking-hint').textContent = trackingError || (local.waving ? 'Movement detected ✓' : 'Only your camera · Move in frame');
  $('self-dot').classList.toggle('active', local.waving); $('other-dot').classList.toggle('active', online && remote.waving);
  let phase, title, caption;
  if (presence.connected) [phase, title, caption] = ['04 / CONNECTION', 'A presence made by both of you.', 'Connected. Your movements are becoming one.'];
  else if (presence.mutual) [phase, title, caption] = ['03 / RESPONSE', 'You are answering each other.', 'Keep moving together.'];
  else if (presence.level > .03) [phase, title, caption] = ['05 / DISAPPEARANCE', 'The movement stops. The light remains.', 'Your shared presence is slowly fading.'];
  else if (online && (local.waving || remote.waving)) [phase, title, caption] = ['02 / REACHING OUT', 'A signal crosses the space.', local.waving ? 'Your movement is reaching them. Move together to connect.' : 'They are moving. Move your body to respond.'];
  else [phase, title, caption] = ['01 / SEPARATION', 'Reach across the space.', online ? 'You are both here. Try moving together.' : now - sameRoleAt < 2500 ? 'You chose the same color. One of you should change presence.' : signalStatus === 'error' ? 'Connection unavailable. Check your internet, then rejoin or try Demo.' : 'Your friend can open this same link and choose ' + (role === 'A' ? 'B.' : 'A.')];
  $('phase-label').textContent = phase; $('phase-title').textContent = title; $('phase-caption').textContent = demo ? 'Demo preview · Both participants are simulated' : caption;
  $('connection-progress').style.width = `${Math.max(presence.progress, presence.level) * 100}%`;
}
$('join-a').addEventListener('click', () => enter('A', params.get('input') === 'keyboard' ? 'keyboard' : 'camera'));
$('join-b').addEventListener('click', () => enter('B', params.get('input') === 'keyboard' ? 'keyboard' : 'camera'));
$('use-keyboard').addEventListener('click', () => enter(role, 'keyboard'));
$('start-demo').addEventListener('click', enterDemo);
$('demo-toggle').addEventListener('click', () => { if (demo) leave(); else enterDemo(); });
$('cancel-loading').addEventListener('click', () => { stopCamera(); $('loading').hidden = true; });
$('leave').addEventListener('click', leave);
document.addEventListener('keydown', event => {
  if (event.code === 'Space' && active && mode === 'keyboard' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); pressed = true; }
});
document.addEventListener('keyup', event => { if (event.code === 'Space') pressed = false; });
window.addEventListener('blur', () => { pressed = false; pointerHeld = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pressed = false; pointerHeld = false; local = idle(); motionDetector.reset(); transport?.send(local, mode); }
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
