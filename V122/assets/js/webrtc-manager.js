/**
 * WebRTC Manager - Native WebRTC Implementation
 * Modified and maintained by Moncef Issam
 * 
 * Handles peer connections, media streams, STUN servers,
 * ICE candidate exchange, and connection lifecycle management.
 */

class WebRTCManager {
  constructor(config = {}) {
    this.config = {
      stunServers: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302'
      ],
      iceServers: config.iceServers || [],
      mediaConstraints: {
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }
      },
      ...config
    };

    this.peerConnections = new Map();
    this.localStream = null;
    this.signalingChannel = null;
    this.userRole = config.userRole || 'student';
    this.userId = config.userId || null;
    this.meetingCode = config.meetingCode || null;
    this.eventHandlers = {};
    this.audioEnabled = true;
    this.videoEnabled = true;
  }

  /**
   * Initialize WebRTC manager and get local media stream
   */
  async initialize() {
    try {
      // Add STUN servers to ICE servers config
      const iceServers = [
        { urls: this.config.stunServers }
      ].concat(this.config.iceServers);

      this.config.iceServers = iceServers;

      // Request media access
      this.localStream = await navigator.mediaDevices.getUserMedia(
        this.config.mediaConstraints
      );

      console.log('✓ Local media stream acquired');
      this.emit('local-stream', this.localStream);
      return this.localStream;
    } catch (error) {
      console.error('✗ Failed to get media access:', error.message);
      this.emit('error', {
        type: 'media-access-error',
        message: error.message,
        details: error
      });
      throw error;
    }
  }

  /**
   * Create peer connection for a remote user
   */
  createPeerConnection(peerId) {
    if (this.peerConnections.has(peerId)) {
      console.warn(`Peer connection already exists for ${peerId}`);
      return this.peerConnections.get(peerId);
    }

    const peerConnection = new RTCPeerConnection({
      iceServers: this.config.iceServers
    });

    // Add local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, this.localStream);
      });
    }

    // Handle ICE candidates
    peerConnection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        console.log('ICE candidate:', event.candidate);
        this.emit('ice-candidate', {
          to: peerId,
          candidate: event.candidate
        });
      }
    });

    // Handle remote stream
    peerConnection.addEventListener('track', (event) => {
      console.log('Remote track received from', peerId);
      this.emit('remote-stream', {
        peerId,
        stream: event.streams[0],
        track: event.track
      });
    });

    // Handle connection state changes
    peerConnection.addEventListener('connectionstatechange', () => {
      console.log(`Connection state with ${peerId}: ${peerConnection.connectionState}`);
      this.emit('connection-state-change', {
        peerId,
        state: peerConnection.connectionState
      });

      if (peerConnection.connectionState === 'failed') {
        this.emit('connection-failed', { peerId });
        this.attemptReconnection(peerId);
      }
      if (peerConnection.connectionState === 'disconnected') {
        this.emit('connection-disconnected', { peerId });
      }
    });

    // Handle ICE connection state
    peerConnection.addEventListener('iceconnectionstatechange', () => {
      console.log(`ICE state with ${peerId}: ${peerConnection.iceConnectionState}`);
      this.emit('ice-state-change', {
        peerId,
        state: peerConnection.iceConnectionState
      });
    });

    // Handle signaling state
    peerConnection.addEventListener('signalingstatechange', () => {
      console.log(`Signaling state with ${peerId}: ${peerConnection.signalingState}`);
    });

    this.peerConnections.set(peerId, peerConnection);
    console.log(`✓ Peer connection created for ${peerId}`);
    return peerConnection;
  }

  /**
   * Create and send offer to remote peer
   */
  async createOffer(peerId) {
    try {
      const peerConnection = this.createPeerConnection(peerId);
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      await peerConnection.setLocalDescription(offer);
      console.log(`✓ Offer created for ${peerId}`);

      this.emit('offer', {
        to: peerId,
        offer: offer
      });

      return offer;
    } catch (error) {
      console.error('Failed to create offer:', error);
      this.emit('error', {
        type: 'offer-creation-error',
        peerId,
        message: error.message
      });
      throw error;
    }
  }

  /**
   * Handle incoming offer and create answer
   */
  async handleOffer(peerId, offer) {
    try {
      const peerConnection = this.createPeerConnection(peerId);
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      console.log(`✓ Answer created for ${peerId}`);

      this.emit('answer', {
        to: peerId,
        answer: answer
      });

      return answer;
    } catch (error) {
      console.error('Failed to handle offer:', error);
      this.emit('error', {
        type: 'offer-handling-error',
        peerId,
        message: error.message
      });
      throw error;
    }
  }

  /**
   * Handle incoming answer
   */
  async handleAnswer(peerId, answer) {
    try {
      const peerConnection = this.peerConnections.get(peerId);
      if (!peerConnection) {
        throw new Error(`No peer connection exists for ${peerId}`);
      }

      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
      console.log(`✓ Answer handled for ${peerId}`);
    } catch (error) {
      console.error('Failed to handle answer:', error);
      this.emit('error', {
        type: 'answer-handling-error',
        peerId,
        message: error.message
      });
      throw error;
    }
  }

  /**
   * Add ICE candidate
   */
  async addIceCandidate(peerId, candidate) {
    try {
      const peerConnection = this.peerConnections.get(peerId);
      if (!peerConnection) {
        throw new Error(`No peer connection exists for ${peerId}`);
      }

      await peerConnection.addIceCandidate(
        new RTCIceCandidate(candidate)
      );
      console.log(`✓ ICE candidate added for ${peerId}`);
    } catch (error) {
      console.error('Failed to add ICE candidate:', error);
      this.emit('error', {
        type: 'ice-candidate-error',
        peerId,
        message: error.message
      });
    }
  }

  /**
   * Toggle audio
   */
  toggleAudio(enabled) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
      this.audioEnabled = enabled;
      this.emit('audio-toggled', { enabled });
      console.log(`Audio ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Toggle video
   */
  toggleVideo(enabled) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
      this.videoEnabled = enabled;
      this.emit('video-toggled', { enabled });
      console.log(`Video ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Mute remote peer (teacher only)
   */
  muteRemoteAudio(peerId) {
    if (this.userRole !== 'teacher') {
      console.warn('Only teachers can mute other participants');
      return false;
    }

    const peerConnection = this.peerConnections.get(peerId);
    if (peerConnection) {
      peerConnection.getSenders().forEach(sender => {
        if (sender.track && sender.track.kind === 'audio') {
          sender.track.enabled = false;
        }
      });
      this.emit('remote-audio-muted', { peerId });
      return true;
    }
    return false;
  }

  /**
   * Unmute remote peer (teacher only)
   */
  unmuteRemoteAudio(peerId) {
    if (this.userRole !== 'teacher') {
      console.warn('Only teachers can unmute other participants');
      return false;
    }

    const peerConnection = this.peerConnections.get(peerId);
    if (peerConnection) {
      peerConnection.getSenders().forEach(sender => {
        if (sender.track && sender.track.kind === 'audio') {
          sender.track.enabled = true;
        }
      });
      this.emit('remote-audio-unmuted', { peerId });
      return true;
    }
    return false;
  }

  /**
   * Attempt to reconnect to failed peer
   */
  async attemptReconnection(peerId, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      console.log(`Reconnection attempt ${i + 1}/${maxRetries} for ${peerId}`);
      try {
        // Close existing connection
        const oldConnection = this.peerConnections.get(peerId);
        if (oldConnection) {
          oldConnection.close();
          this.peerConnections.delete(peerId);
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));

        // Create new connection
        await this.createOffer(peerId);
        this.emit('reconnection-success', { peerId, attempt: i + 1 });
        return true;
      } catch (error) {
        console.error(`Reconnection attempt ${i + 1} failed:`, error);
      }
    }

    this.emit('reconnection-failed', { peerId, attempts: maxRetries });
    return false;
  }

  /**
   * Close peer connection
   */
  closePeerConnection(peerId) {
    const peerConnection = this.peerConnections.get(peerId);
    if (peerConnection) {
      peerConnection.close();
      this.peerConnections.delete(peerId);
      this.emit('peer-disconnected', { peerId });
      console.log(`✓ Peer connection closed for ${peerId}`);
    }
  }

  /**
   * Close all connections and cleanup
   */
  cleanup() {
    // Close all peer connections
    this.peerConnections.forEach((peerConnection, peerId) => {
      peerConnection.close();
      this.emit('peer-disconnected', { peerId });
    });
    this.peerConnections.clear();

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.emit('cleanup-complete');
    console.log('✓ WebRTC manager cleaned up');
  }

  /**
   * Get connection statistics
   */
  async getStats(peerId) {
    const peerConnection = this.peerConnections.get(peerId);
    if (!peerConnection) return null;

    const stats = {
      peerId,
      audio: {},
      video: {},
      connection: {}
    };

    try {
      const report = await peerConnection.getStats();
      report.forEach(result => {
        if (result.type === 'inbound-rtp') {
          if (result.mediaType === 'audio') {
            stats.audio.bytesReceived = result.bytesReceived;
            stats.audio.packetsReceived = result.packetsReceived;
            stats.audio.jitter = result.jitter;
          } else if (result.mediaType === 'video') {
            stats.video.bytesReceived = result.bytesReceived;
            stats.video.packetsReceived = result.packetsReceived;
            stats.video.framesDecoded = result.framesDecoded;
          }
        }
        if (result.type === 'candidate-pair' && result.state === 'succeeded') {
          stats.connection.currentRoundTripTime = result.currentRoundTripTime;
          stats.connection.availableOutgoingBitrate = result.availableOutgoingBitrate;
        }
      });
    } catch (error) {
      console.error('Failed to get stats:', error);
    }

    return stats;
  }

  /**
   * Event emission system
   */
  on(event, handler) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
  }

  off(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event] = this.eventHandlers[event].filter(h => h !== handler);
    }
  }

  emit(event, data = null) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Get peer connections count
   */
  getPeerCount() {
    return this.peerConnections.size;
  }

  /**
   * Get all peer IDs
   */
  getPeerIds() {
    return Array.from(this.peerConnections.keys());
  }
}