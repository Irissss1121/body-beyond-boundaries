// p5LiveMedia WebRTC for two computers, BroadcastChannel for two local tabs.
// Only small gesture packets are sent. No camera stream is passed to p5LiveMedia.
export class RoomTransport {
  constructor(sketch, room, role, onState, onStatus, { webRTCOnly = false } = {}) {
    this.role = role;
    this.clientId = crypto.randomUUID();
    this.sequence = 0;
    this.lastPeer = null;
    this.closed = false;
    this.onState = onState;
    this.onStatus = onStatus;
    this.channel = null;
    const channelName = `body-boundary-v1:${room}`;
    if (!webRTCOnly && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(channelName);
      this.channel.onmessage = event => this.receive(event.data);
    }
    try {
      this.link = new p5LiveMedia(sketch, 'DATA', null, channelName);
      this.link.on('data', (data, peerId) => {
        try { this.receive(JSON.parse(data), peerId); } catch { /* Ignore malformed packets. */ }
      });
      this.link.socket.on('connect', () => onStatus('ready'));
      this.link.socket.on('connect_error', () => onStatus('error'));
      this.link.socket.on('disconnect', () => onStatus('reconnecting'));
    } catch (error) {
      onStatus('error');
      console.warn('p5LiveMedia connection unavailable', error);
    }
  }

  receive(packet, peerId = null) {
    if (this.closed || !packet || packet.protocol !== 1 || packet.clientId === this.clientId) return;
    if (typeof packet.clientId !== 'string' || packet.clientId.length > 80 || !['A', 'B'].includes(packet.role)) return;
    if (packet.role === this.role) { this.onStatus('same-role'); return; }
    if (!Number.isSafeInteger(packet.seq) || packet.seq < 0 || typeof packet.waving !== 'boolean') return;
    const now = performance.now();
    // A room has two participants. Keep the current partner until its heartbeat expires.
    if (this.lastPeer && this.lastPeer.id !== packet.clientId && now - this.lastPeer.at < 2000) return;
    if (this.lastPeer?.id === packet.clientId && packet.seq <= this.lastPeer.seq) return;
    if (![packet.energy, packet.handY].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return;
    const hands = Array.isArray(packet.hands) ? packet.hands.slice(0, 2).filter(h => h && [h.x, h.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)).map(h => ({ x: h.x, y: h.y })) : [];
    this.lastPeer = { id: packet.clientId, seq: packet.seq, at: now, peerId };
    this.onState({ waving: packet.waving, energy: packet.energy, handY: packet.handY, hands, receivedAt: now, mode: packet.mode === 'keyboard' ? 'keyboard' : 'camera' });
  }

  send(state, mode) {
    if (this.closed) return;
    const packet = { protocol: 1, clientId: this.clientId, role: this.role, seq: ++this.sequence, mode,
      waving: !!state.waving, energy: state.energy || 0, handY: state.handY ?? 0.5,
      hands: (state.hands || []).map(h => ({ x: h.x, y: h.y })) };
    this.channel?.postMessage(packet);
    try { this.link?.send(JSON.stringify(packet)); } catch { this.onStatus('reconnecting'); }
  }

  close() {
    this.closed = true;
    this.channel?.close();
    this.link?.simplepeers?.forEach(peer => peer.simplepeer.destroy());
    this.link?.socket?.disconnect();
  }
}
