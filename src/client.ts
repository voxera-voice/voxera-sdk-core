import EventEmitter from "eventemitter3";
import { io, Socket as SocketIOSocket } from "socket.io-client";
import * as mediasoupClient from 'mediasoup-client';
import type {
  VoxeraConfig,
  ConnectionStatus,
  ConversationStatus,
  SpeakingStatus,
  ConversationMessage,
  VoxeraEvents,
  WebRTCStats,
  InitSessionResponse,
  RoomMode,
  RoomParticipant,
  TranscriptionEntry,
  WaitingRoomEntry,
  MeetingCallbacks,
  MeetingBookmark,
  MeetingSummary,
  MeetingMinutes,
} from "./types";
import { VoxeraError, ErrorCodes } from "./types";

/**
 * Maya Voice Client - Core SDK
 *
 * This is the main client class for connecting to the Maya Voice platform.
 * It handles mediasoup WebRTC connections, signaling, and voice AI interactions.
 */
export class VoxeraClient extends EventEmitter<VoxeraEvents> {
  private config: VoxeraConfig;
  private socket: SocketIOSocket | null = null;

  // Mediasoup properties (using any to avoid type import issues)
  private device: any = null;
  private sendTransport: any = null;
  private recvTransport: any = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private localVideoStream: MediaStream | null = null;
  private remoteVideoStream: MediaStream | null = null;
  private videoProducer: any = null;
  private audioProducer: any = null;
  private screenShareStream: MediaStream | null = null;
  private screenShareProducer: any = null;
  private aiAudioElements: Map<string, HTMLAudioElement> = new Map();
  private aiConsumers: Map<string, any> = new Map(); // Track AI audio consumers
  private participantConsumers: Map<string, any> = new Map(); // Track participant audio/video consumers

  private _connectionStatus: ConnectionStatus = "idle";
  private _conversationStatus: ConversationStatus = "idle";
  private _speakingStatus: SpeakingStatus = "none";
  private _messages: ConversationMessage[] = [];
  private _seenMessageIds: Set<string> = new Set();
  private _sessionId: string | null = null;

  // Meeting state
  private _roomMode: RoomMode | null = null;
  private _isHost: boolean = false;
  private _meetingCallbacks: MeetingCallbacks = {};

  private reconnectAttempts = 0;
  private audioContext: AudioContext | null = null;
  private audioAnalyser: AnalyserNode | null = null;
  private aiAudioAnalyser: AnalyserNode | null = null; // Separate analyser for AI audio
  private audioLevelInterval: ReturnType<typeof setInterval> | null = null;
  private aiAudioLevelInterval: ReturnType<typeof setInterval> | null = null;
  private hasUserInteracted: boolean = false;
  private pendingAudioStarts: Array<() => void> = [];

  constructor(config: VoxeraConfig) {
    super();
    this.validateConfig(config);
    this.config = config;

    // Set up user interaction detector
    this.setupUserInteractionDetector();

    // Set up default connection options
    this.config.connectionOptions = {
      autoReconnect: true,
      reconnectAttempts: 3,
      reconnectDelay: 1000,
      timeout: 30000,
      ...config.connectionOptions,
    };
  }

  // Getters
  get connectionStatus(): ConnectionStatus {
    return this._connectionStatus;
  }

  get conversationStatus(): ConversationStatus {
    return this._conversationStatus;
  }

  get speakingStatus(): SpeakingStatus {
    return this._speakingStatus;
  }

  get messages(): ConversationMessage[] {
    return [...this._messages];
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  get isConnected(): boolean {
    return this._connectionStatus === "connected";
  }

  /**
   * Access the underlying Socket.IO socket for advanced use (e.g. multi-room events)
   */
  getSocket(): SocketIOSocket | null {
    return this.socket;
  }

  get isConversationActive(): boolean {
    return this._conversationStatus === "active";
  }

  get localVideo(): MediaStream | null {
    return this.localVideoStream;
  }

  get remoteVideo(): MediaStream | null {
    return this.remoteVideoStream;
  }

  get screenShare(): MediaStream | null {
    return this.screenShareStream;
  }

  get isScreenSharing(): boolean {
    return this.screenShareStream !== null;
  }

  get roomMode(): RoomMode | null {
    return this._roomMode;
  }

  get isHost(): boolean {
    return this._isHost;
  }

  /**
   * Register callbacks for meeting events.
   * Call this before creating/joining a room to receive meeting-specific events.
   */
  setMeetingCallbacks(callbacks: MeetingCallbacks): void {
    this._meetingCallbacks = callbacks;
  }

  /**
   * Set up socket listeners for meeting-related events.
   * Call this after socket is connected (after connectSocket or connect).
   */
  setupMeetingListeners(): void {
    if (!this.socket) return;

    // Participant events
    this.socket.on('participant-joined', (data: any) => {
      this.emit('participant:joined', data);
      this._meetingCallbacks.onParticipantJoined?.(data);
    });

    this.socket.on('participant-left', (data: any) => {
      this.emit('participant:left', data);
      this._meetingCallbacks.onParticipantLeft?.(data);
    });

    this.socket.on('participant-removed', (data: any) => {
      this.emit('participant:removed', data);
      this._meetingCallbacks.onParticipantRemoved?.(data);
    });

    this.socket.on('participants-updated', (data: any) => {
      this.emit('participants:updated', data);
      this._meetingCallbacks.onParticipantsUpdated?.(data);
    });

    // Host control events
    this.socket.on('you-were-muted', (data: any) => {
      this.emit('you:muted', data);
      this._meetingCallbacks.onYouWereMuted?.(data);
    });

    this.socket.on('you-were-removed', (data: any) => {
      this.emit('you:removed', data);
      this._meetingCallbacks.onYouWereRemoved?.(data);
    });

    this.socket.on('all-muted', (data: any) => {
      this.emit('you:muted', data); // Also emit personal mute
      this._meetingCallbacks.onAllMuted?.(data);
    });

    this.socket.on('all-unmuted', (data: any) => {
      this._meetingCallbacks.onAllUnmuted?.(data);
    });

    this.socket.on('host-changed', (data: any) => {
      // Update local isHost state
      if (this.socket) {
        this._isHost = data.newHostClientId === this.socket.id;
      }
      this.emit('host:changed', data);
      this._meetingCallbacks.onHostChanged?.(data);
    });

    this.socket.on('meeting-ended', (data: any) => {
      this.emit('meeting:ended', data);
      this._meetingCallbacks.onMeetingEnded?.(data);
    });

    this.socket.on('room-locked-changed', (data: any) => {
      this.emit('room:locked', data);
      this._meetingCallbacks.onRoomLockedChanged?.(data);
    });

    // Transcription events
    this.socket.on('transcription-toggled', (data: any) => {
      this.emit('transcription:toggled', data);
      this._meetingCallbacks.onTranscriptionToggled?.(data);
    });

    this.socket.on('live-transcription', (data: any) => {
      this.emit('transcription:live', data);
      this._meetingCallbacks.onLiveTranscription?.(data);
    });

    // Ask AI events
    this.socket.on('ask-ai-started', (data: any) => {
      this.emit('ask-ai:started', data);
      this._meetingCallbacks.onAskAiStarted?.(data);
    });

    this.socket.on('ask-ai-processing', () => {
      this.emit('ask-ai:processing');
      this._meetingCallbacks.onAskAiProcessing?.();
    });

    this.socket.on('ask-ai-cancelled', (data: any) => {
      this.emit('ask-ai:cancelled', data);
      this._meetingCallbacks.onAskAiCancelled?.(data);
    });

    // Phase 3: Text-only AI events (normal-meeting mode)
    this.socket.on('ask-ai-text-started', (data: any) => {
      this.emit('ask-ai-text:started', data);
      this._meetingCallbacks.onAskAiTextStarted?.(data);
    });

    this.socket.on('ask-ai-text-chunk', (data: any) => {
      this.emit('ask-ai-text:chunk', data);
      this._meetingCallbacks.onAskAiTextChunk?.(data);
    });

    this.socket.on('ask-ai-text-response', (data: any) => {
      this.emit('ask-ai-text:response', data);
      this._meetingCallbacks.onAskAiTextResponse?.(data);
    });

    this.socket.on('ask-ai-text-error', (data: any) => {
      this.emit('ask-ai-text:error', data);
      this._meetingCallbacks.onAskAiTextError?.(data);
    });

    // Waiting room events
    this.socket.on('waiting-room', (data: any) => {
      this.emit('waiting-room:status', data);
      this._meetingCallbacks.onWaitingRoom?.(data);
    });

    this.socket.on('admitted', (data: any) => {
      this._roomMode = data.roomMode || null;
      this.emit('waiting-room:admitted', data);
      this._meetingCallbacks.onAdmitted?.(data);
    });

    this.socket.on('denied', (data: any) => {
      this.emit('waiting-room:denied', data);
      this._meetingCallbacks.onDenied?.(data);
    });

    this.socket.on('waiting-room-updated', (data: any) => {
      this.emit('waiting-room:updated', data);
      this._meetingCallbacks.onWaitingRoomUpdated?.(data);
    });

    this.socket.on('waiting-room-toggled', (data: any) => {
      this.emit('waiting-room:toggled', data);
      this._meetingCallbacks.onWaitingRoomToggled?.(data);
    });

    // Phase 2: AI Differentiator events
    this.socket.on('summary-generating', (data: any) => {
      this.emit('summary:generating', data);
      this._meetingCallbacks.onSummaryGenerating?.(data);
    });

    this.socket.on('summary-generated', (data: any) => {
      this.emit('summary:generated', data);
      this._meetingCallbacks.onSummaryGenerated?.(data);
    });

    this.socket.on('minutes-generating', (data: any) => {
      this.emit('minutes:generating', data);
      this._meetingCallbacks.onMinutesGenerating?.(data);
    });

    this.socket.on('minutes-generated', (data: any) => {
      this.emit('minutes:generated', data);
      this._meetingCallbacks.onMinutesGenerated?.(data);
    });

    this.socket.on('bookmark-added', (data: any) => {
      this.emit('bookmark:added', data);
      this._meetingCallbacks.onBookmarkAdded?.(data);
    });

    this.socket.on('bookmark-removed', (data: any) => {
      this.emit('bookmark:removed', data);
      this._meetingCallbacks.onBookmarkRemoved?.(data);
    });
  }

  // ─── HOST CONTROL METHODS ──────────────────────────────────────────

  /**
   * Mute a specific participant (host only)
   */
  async muteParticipant(sessionId: string, targetClientId: string): Promise<any> {
    return this.socket?.emitWithAck('mute-participant', { sessionId, targetClientId });
  }

  /**
   * Mute all participants except host (host only)
   */
  async muteAll(sessionId: string): Promise<any> {
    return this.socket?.emitWithAck('mute-all', { sessionId });
  }

  /**
   * Unmute all participants (host only)
   */
  async unmuteAll(sessionId: string): Promise<any> {
    return this.socket?.emitWithAck('unmute-all', { sessionId });
  }

  /**
   * Remove a participant from the room (host only)
   */
  async removeParticipant(sessionId: string, targetClientId: string): Promise<any> {
    return this.socket?.emitWithAck('remove-participant', { sessionId, targetClientId });
  }

  /**
   * Lock/unlock the room (host only)
   */
  async lockRoom(sessionId: string, locked: boolean): Promise<any> {
    return this.socket?.emitWithAck('lock-room', { sessionId, locked });
  }

  /**
   * End the meeting for all participants (host only)
   */
  async endMeeting(sessionId: string): Promise<any> {
    return this.socket?.emitWithAck('end-meeting', { sessionId });
  }

  /**
   * Transfer host role to another participant (host only)
   */
  async transferHost(sessionId: string, targetClientId: string): Promise<any> {
    return this.socket?.emitWithAck('transfer-host', { sessionId, targetClientId });
  }

  /**
   * Toggle transcription on/off (host only)
   */
  async toggleTranscription(sessionId: string, enabled: boolean): Promise<any> {
    return this.socket?.emitWithAck('toggle-transcription', { sessionId, enabled });
  }

  /**
   * Trigger Ask AI mode — collects transcript and sends to AI
   */
  async askAi(sessionId: string): Promise<any> {
    return this.socket?.emitWithAck('ask-ai', { sessionId });
  }

  /**
   * Cancel an active Ask AI request
   */
  async cancelAskAi(sessionId: string): Promise<any> {
    return this.socket?.emitWithAck('cancel-ask-ai', { sessionId });
  }

  /**
   * Ask AI for a text-only response (normal-meeting mode).
   * Sends transcript + optional prompt to AI for a text response, no audio/TTS.
   */
  async askAiText(sessionId: string, prompt?: string): Promise<any> {
    return this.socket?.emitWithAck('ask-ai-text', { sessionId, prompt });
  }

  /**
   * Enable/disable waiting room (host only)
   */
  async enableWaitingRoom(sessionId: string, enabled: boolean): Promise<any> {
    return this.socket?.emitWithAck('enable-waiting-room', { sessionId, enabled });
  }

  /**
   * Admit a participant from the waiting room (host only)
   */
  async admitParticipant(sessionId: string, targetClientId: string): Promise<any> {
    return this.socket?.emitWithAck('admit-participant', { sessionId, targetClientId });
  }

  /**
   * Deny a participant from the waiting room (host only)
   */
  async denyParticipant(sessionId: string, targetClientId: string): Promise<any> {
    return this.socket?.emitWithAck('deny-participant', { sessionId, targetClientId });
  }

  /**
   * Admit all waiting room participants (host only)
   */
  async admitAll(sessionId: string): Promise<any> {
    return this.socket?.emitWithAck('admit-all', { sessionId });
  }

  // ─── PHASE 2: AI DIFFERENTIATOR METHODS ───────────────────────────

  /**
   * Generate an AI summary of the current meeting transcript
   */
  async generateSummary(sessionId: string): Promise<any> {
    return this.socket?.emitWithAck('generate-summary', { sessionId });
  }

  /**
   * Generate comprehensive AI meeting minutes (host only)
   */
  async generateMinutes(sessionId: string): Promise<any> {
    return this.socket?.emitWithAck('generate-minutes', { sessionId });
  }

  /**
   * Add a bookmark / key moment to the meeting
   */
  async addBookmark(sessionId: string, label: string, isActionItem: boolean = false): Promise<any> {
    return this.socket?.emitWithAck('add-bookmark', { sessionId, label, isActionItem });
  }

  /**
   * Remove a bookmark (host only)
   */
  async removeBookmark(sessionId: string, bookmarkId: string): Promise<any> {
    return this.socket?.emitWithAck('remove-bookmark', { sessionId, bookmarkId });
  }

  /**
   * Get all bookmarks for the current session
   */
  async getBookmarks(sessionId: string): Promise<any> {
    return this.socket?.emitWithAck('get-bookmarks', { sessionId });
  }

  /**
   * Get the full transcript for the current session
   */
  async getTranscript(sessionId: string): Promise<any> {
    return this.socket?.emitWithAck('get-transcript', { sessionId });
  }

  /**
   * Get all summaries generated for the current session
   */
  async getSummaries(sessionId: string): Promise<any> {
    return this.socket?.emitWithAck('get-summaries', { sessionId });
  }

  /**
   * Get meeting minutes for the current session
   */
  async getMinutes(sessionId: string): Promise<any> {
    return this.socket?.emitWithAck('get-minutes', { sessionId });
  }

  /**
   * Set the room mode and host state (called after create-room or join-room)
   */
  setRoomInfo(roomMode: RoomMode, isHost: boolean): void {
    this._roomMode = roomMode;
    this._isHost = isHost;
  }

  /**
   * Set up listener for user interaction to enable audio playback
   */
  private setupUserInteractionDetector(): void {
    const enableAudio = () => {
      console.log('[Maya] User interaction detected, enabling audio playback');
      this.hasUserInteracted = true;

      // Start all pending audio elements
      this.pendingAudioStarts.forEach(fn => fn());
      this.pendingAudioStarts = [];

      // Remove listeners after first interaction
      document.removeEventListener('click', enableAudio);
      document.removeEventListener('touchstart', enableAudio);
      document.removeEventListener('keypress', enableAudio);
    };

    document.addEventListener('click', enableAudio, { once: true });
    document.addEventListener('touchstart', enableAudio, { once: true });
    document.addEventListener('keypress', enableAudio, { once: true });
  }

  /**
   * Connect to the Maya Voice server
   */
  async connect(): Promise<void> {
    if (
      this._connectionStatus === "connected" ||
      this._connectionStatus === "connecting"
    ) {
      return;
    }

    this.setConnectionStatus("connecting");

    try {
      // Initialize session with API
      const session = await this.initSession();
      this._sessionId = session.data?.sessionId || session.sessionId || null;

      // Request microphone access BEFORE setting up WebRTC (matching voxera pattern)
      await this.requestMicrophoneAccess();

      // Connect WebSocket
      await this.connectWebSocket(session);

      // Set up WebRTC and produce audio track immediately
      await this.setupWebRTC(session);

      this.setConnectionStatus("connected");
    } catch (error) {
      this.handleError(error as Error);
      this.setConnectionStatus("error");
      throw error;
    }
  }

  /**
   * Connect socket only — no session init or WebRTC.
   * Use this for multi-room flows where create-room / join-room handles session creation.
   * After calling this, use setupRoomWebRTC() once the room session exists on the server.
   */
  async connectSocket(): Promise<void> {
    if (
      this._connectionStatus === "connected" ||
      this._connectionStatus === "connecting"
    ) {
      return;
    }

    this.setConnectionStatus("connecting");

    try {
      // Open a socket.io connection without init-session-connection
      await this.connectWebSocketOnly();
      this.setConnectionStatus("connected");
    } catch (error) {
      this.handleError(error as Error);
      this.setConnectionStatus("error");
      throw error;
    }
  }

  /**
   * Set up microphone + WebRTC transports after the server-side session already exists
   * (e.g. after create-room or join-room registered the participant).
   */
  async setupRoomWebRTC(): Promise<void> {
    if (!this.socket) {
      throw new VoxeraError(
        "Socket not connected — call connectSocket() first",
        ErrorCodes.CONNECTION_FAILED
      );
    }

    await this.requestMicrophoneAccess();
    await this.setupWebRTC({} as any);
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    if (
      this._connectionStatus === "disconnected" ||
      this._connectionStatus === "idle"
    ) {
      return;
    }

    try {
      // End conversation if active
      if (this._conversationStatus === "active") {
        await this.endConversation();
      }

      // Clean up
      this.cleanup();
      this.setConnectionStatus("disconnected");
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Start a voice conversation
   */
  async startConversation(): Promise<void> {
    if (this._connectionStatus !== "connected") {
      throw new VoxeraError(
        "Must be connected before starting conversation",
        ErrorCodes.CONNECTION_FAILED
      );
    }

    if (this._conversationStatus === "active") {
      return;
    }

    this.setConversationStatus("starting");

    try {
      // Microphone access already granted during connect()
      // Just unmute if previously muted
      this.setMuted(false);

      // Send start conversation signal
      this.sendSignal({
        type: "conversation:start",
        config: {},
      });

      this.setConversationStatus("active");
    } catch (error) {
      this.setConversationStatus("idle");
      this.handleError(error as Error);
      throw error;
    }
  }

  /**
   * End the current conversation
   */
  async endConversation(): Promise<void> {
    if (this._conversationStatus !== "active") {
      return;
    }

    this.setConversationStatus("ending");

    try {
      // Send end conversation signal
      this.sendSignal({ type: "conversation:end" });

      // Stop local stream
      this.stopLocalStream();

      this.setConversationStatus("ended");
    } catch (error) {
      this.handleError(error as Error);
    } finally {
      this.setConversationStatus("idle");
    }
  }

  /**
   * Send a text message (for testing or text-based interactions)
   */
  sendMessage(content: string): void {
    if (this._connectionStatus !== "connected") {
      throw new VoxeraError(
        "Must be connected to send messages",
        ErrorCodes.CONNECTION_FAILED
      );
    }

    const message: ConversationMessage = {
      id: this.generateId(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    this._messages.push(message);
    this.emit("message", message);

    this.sendSignal({
      type: "message:send",
      message,
    });
  }

  /**
   * Mute/unmute the microphone
   */
  setMuted(muted: boolean): void {
    console.log(`[Maya] ${muted ? 'Muting' : 'Unmuting'} audio`);

    // Disable/enable the audio track
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
        console.log(`[Maya] Audio track enabled: ${track.enabled}`);
      });
    }

    // Pause/resume the audio producer
    if (this.audioProducer) {
      if (muted) {
        console.log('[Maya] Pausing audio producer');
        this.audioProducer.pause();
      } else {
        console.log('[Maya] Resuming audio producer');
        this.audioProducer.resume();
      }
    } else {
      console.warn('[Maya] No audio producer found');
    }
  }

  /**
   * Enable video
   */
  async enableVideo(): Promise<void> {
    if (this.localVideoStream) {
      // Video already enabled
      console.log('[Maya] Video already enabled');
      return;
    }

    try {
      console.log('[Maya] Requesting camera access...');
      const videoConfig = this.config.videoConfig || {};

      // Get video stream
      this.localVideoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: videoConfig.width || 1280 },
          height: { ideal: videoConfig.height || 720 },
          frameRate: { ideal: videoConfig.frameRate || 30 },
          facingMode: videoConfig.facingMode || 'user',
        },
      });

      console.log('[Maya] Camera access granted, stream obtained:', this.localVideoStream.id);

      // Emit local video stream
      this.emit('video:local', this.localVideoStream);
      this.config.onLocalVideoStream?.(this.localVideoStream);

      // Produce video if transport exists
      if (this.sendTransport && this._connectionStatus === 'connected') {
        const videoTrack = this.localVideoStream.getVideoTracks()[0];

        console.log('[Maya] Creating video producer...');
        console.log('[Maya] Video track state:', {
          id: videoTrack.id,
          kind: videoTrack.kind,
          label: videoTrack.label,
          enabled: videoTrack.enabled,
          muted: videoTrack.muted,
          readyState: videoTrack.readyState
        });

        // Disable simulcast when video AI is enabled to avoid PlainTransport compatibility issues
        const useSimulcast = !this.config.videoConfig?.enableVideoAI;

        this.videoProducer = await this.sendTransport.produce({
          track: videoTrack,
          // Single encoding for AI (PlainTransport), simulcast otherwise
          encodings: useSimulcast ? [
            { maxBitrate: 500000 },
            { maxBitrate: 1000000 },
            { maxBitrate: 1500000 },
          ] : [
            { maxBitrate: 1000000 }, // Single layer for AI capture
          ],
          codecOptions: {
            videoGoogleStartBitrate: 1000,
          },
        });

        console.log('[Maya] Video producer created:', this.videoProducer.id);
        console.log('[Maya] Simulcast:', useSimulcast ? 'enabled (3 layers)' : 'disabled (AI mode)');
        console.log('[Maya] Video producer paused:', this.videoProducer.paused);
        console.log('[Maya] Send transport state:', this.sendTransport.connectionState);

        // Check producer stats after 2 seconds to verify video is flowing
        setTimeout(async () => {
          try {
            const stats = await this.videoProducer!.getStats();
            console.log('[Maya] Video producer stats after 2s:', stats);

            // Check if any bytes are being sent
            let bytesSent = 0;
            stats.forEach((report: any) => {
              if (report.type === 'outbound-rtp' && report.bytesSent) {
                bytesSent = report.bytesSent;
              }
            });

            if (bytesSent === 0) {
              console.error('[Maya] ❌ Video producer NOT sending any data!');
              console.error('[Maya] Track state:', {
                enabled: videoTrack.enabled,
                muted: videoTrack.muted,
                readyState: videoTrack.readyState
              });
              console.error('[Maya] Transport state:', this.sendTransport?.connectionState);
            } else {
              console.log(`[Maya] ✅ Video producer sent ${bytesSent} bytes`);
            }
          } catch (err) {
            console.error('[Maya] Failed to get video producer stats:', err);
          }
        }, 2000);

        // Resume producer if paused
        if (this.videoProducer.paused) {
          console.log('[Maya] Resuming video producer...');
          await this.videoProducer.resume();
          console.log('[Maya] Video producer resumed');
        }
      } else {
        console.log('[Maya] Video stream obtained but not connected yet. Will produce when connected.');
      }
    } catch (error: any) {
      console.error('[Maya] Camera access failed:', error);
      const errorMessage = error.name === 'NotAllowedError'
        ? 'Camera access denied. Please grant camera permissions in your browser.'
        : error.name === 'NotFoundError'
          ? 'No camera found. Please connect a camera device.'
          : error.name === 'NotReadableError'
            ? 'Camera is already in use by another application.'
            : `Failed to access camera: ${error.message}`;

      throw new VoxeraError(
        errorMessage,
        ErrorCodes.MEDIA_ACCESS_DENIED
      );
    }
  }

  /**
   * Disable video
   */
  async disableVideo(): Promise<void> {
    console.log('[Maya] Disabling video...');
    if (this.localVideoStream) {
      this.localVideoStream.getTracks().forEach((track) => track.stop());
      this.localVideoStream = null;
    }

    if (this.videoProducer) {
      this.videoProducer.close();
      this.videoProducer = null;
      console.log('[Maya] Video producer closed');
    }
  }

  /**
   * Toggle video on/off
   */
  async toggleVideo(): Promise<boolean> {
    if (this.localVideoStream) {
      await this.disableVideo();
      return false;
    } else {
      await this.enableVideo();
      return true;
    }
  }

  /**
   * Start sharing the user's screen (or an application window / browser tab).
   * Produces a second video track through the existing send transport so the
   * server receives screen frames independently from the camera.
   */
  async startScreenShare(): Promise<void> {
    if (this.screenShareStream) {
      console.log('[Maya] Screen sharing already active');
      return;
    }

    try {
      console.log('[Maya] Requesting screen share access...');
      const screenConfig = this.config.screenShareConfig || {};

      this.screenShareStream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: {
          width: { ideal: screenConfig.width || 1920 },
          height: { ideal: screenConfig.height || 1080 },
          frameRate: { ideal: screenConfig.frameRate || 15 },
        },
        audio: screenConfig.audio ?? false,
      });

      const stream = this.screenShareStream!;
      console.log('[Maya] Screen share access granted, stream:', stream.id);

      this.emit('screen:local', stream);
      this.config.onLocalScreenStream?.(stream);

      // Produce screen track if send transport is ready
      if (this.sendTransport && this._connectionStatus === 'connected') {
        const screenTrack = stream.getVideoTracks()[0];

        this.screenShareProducer = await this.sendTransport.produce({
          track: screenTrack,
          encodings: [
            { maxBitrate: 1500000 }, // Single layer — no simulcast
          ],
          codecOptions: {
            videoGoogleStartBitrate: 1000,
          },
          appData: { mediaType: 'screen' }, // Tag so server can distinguish
        });

        console.log('[Maya] Screen share producer created:', this.screenShareProducer.id);

        if (this.screenShareProducer.paused) {
          await this.screenShareProducer.resume();
          console.log('[Maya] Screen share producer resumed');
        }
      } else {
        console.log('[Maya] Screen share stream obtained but transport not ready yet.');
      }

      // Handle the user stopping screen share via the browser's built-in UI
      const screenTrack = stream.getVideoTracks()[0];
      screenTrack.addEventListener('ended', () => {
        console.log('[Maya] Screen share track ended by user');
        this.stopScreenShare();
      });
    } catch (error: any) {
      // User cancelled the picker — not an error worth throwing
      if (error.name === 'NotAllowedError') {
        console.log('[Maya] Screen share permission denied or picker cancelled');
        return;
      }
      throw new VoxeraError(
        `Screen share failed: ${error.message}`,
        ErrorCodes.MEDIA_ACCESS_DENIED
      );
    }
  }

  /**
   * Stop screen sharing
   */
  async stopScreenShare(): Promise<void> {
    console.log('[Maya] Stopping screen share...');

    if (this.screenShareStream) {
      this.screenShareStream.getTracks().forEach((track) => track.stop());
      this.screenShareStream = null;
      this.emit('screen:local', null);
      this.config.onLocalScreenStream?.(null);
    }

    if (this.screenShareProducer) {
      this.screenShareProducer.close();
      this.screenShareProducer = null;
      console.log('[Maya] Screen share producer closed');
    }
  }

  /**
   * Toggle screen sharing on/off.
   * Returns true when screen sharing starts, false when it stops.
   */
  async toggleScreenShare(): Promise<boolean> {
    if (this.screenShareStream) {
      await this.stopScreenShare();
      return false;
    } else {
      await this.startScreenShare();
      return this.screenShareStream !== null;
    }
  }

  /**
   * Get WebRTC statistics
   */
  async getStats(): Promise<WebRTCStats | null> {
    if (!this.sendTransport) {
      return null;
    }

    try {
      const stats = await this.sendTransport.getStats();
      let result: WebRTCStats = {
        bytesReceived: 0,
        bytesSent: 0,
        packetsReceived: 0,
        packetsSent: 0,
      };

      stats.forEach((report: any) => {
        if (report.type === "inbound-rtp" && report.kind === "audio") {
          result.bytesReceived = report.bytesReceived || 0;
          result.packetsReceived = report.packetsReceived || 0;
          result.jitter = report.jitter;
        }
        if (report.type === "outbound-rtp" && report.kind === "audio") {
          result.bytesSent = report.bytesSent || 0;
          result.packetsSent = report.packetsSent || 0;
        }
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          result.roundTripTime = report.currentRoundTripTime;
        }
      });

      return result;
    } catch {
      return null;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<VoxeraConfig>): void {
    this.config = { ...this.config, ...config };

    // Send config update to server if connected
    if (this._connectionStatus === "connected") {
      this.sendSignal({
        type: "config:update",
        config: {},
      });
    }
  }

  // Private Methods

  private validateConfig(config: VoxeraConfig): void {
    if (!config.appKey) {
      throw new VoxeraError("appKey is required", ErrorCodes.INVALID_CONFIG);
    }
    if (!config.serverUrl) {
      throw new VoxeraError(
        "serverUrl is required",
        ErrorCodes.INVALID_CONFIG
      );
    }
  }

  // Store session configuration from server
  private _sessionConfiguration: InitSessionResponse["data"] | null = null;

  get sessionConfiguration() {
    return this._sessionConfiguration;
  }

  private async initSession(): Promise<InitSessionResponse> {
    const apiUrl = this.config.serverUrl
      .replace("wss://", "https://")
      .replace("ws://", "http://");

    const response = await fetch(`${apiUrl}/api/session/init`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.config.appKey,
      },
      body: JSON.stringify({
        agentId: this.config.agentId || this.config.configurationId,
        userId: this.config.userId,
        metadata: this.config.metadata || {},
      }),
    });

    if (!response.ok) {
      throw new VoxeraError(
        "Failed to initialize session",
        ErrorCodes.AUTHENTICATION_FAILED
      );
    }

    const result: InitSessionResponse = await response.json();

    // Handle new API response format
    if (result.success === false && result.error) {
      throw new VoxeraError(
        result.error.message,
        result.error.code as any
      );
    }

    // Store server configuration for use in WebSocket connection
    if (result.data) {
      this._sessionConfiguration = result.data;
      // Return in expected format for backward compatibility
      return {
        ...result,
        sessionId: result.data.sessionId,
        sessionToken: result.data.sessionId, // Use sessionId as token for now
      };
    }

    return result;
  }

  private async connectWebSocket(session: InitSessionResponse): Promise<void> {
    return new Promise((resolve, reject) => {
      const sessionId = session.data?.sessionId || session.sessionId;

      // Create Socket.IO connection
      this.socket = io(this.config.serverUrl, {
        transports: ['websocket'],
        reconnection: false,
      });

      const timeout = setTimeout(() => {
        this.socket?.disconnect();
        reject(
          new VoxeraError("Socket.IO connection timeout", ErrorCodes.TIMEOUT)
        );
      }, this.config.connectionOptions?.timeout || 30000);

      this.socket.on('connect', async () => {
        clearTimeout(timeout);
        this.reconnectAttempts = 0;

        // Send init-session-connection message with user's API key and wait for acknowledgment
        try {
          await this.socket?.emitWithAck('init-session-connection', {
            sessionId,
            appKey: this.config.appKey,
            agentId: this.config.agentId || this.config.configurationId,
            userId: this.config.userId || 'demo-user',
            enableVideoAI: this.config.videoConfig?.enableVideoAI || false,
          });
          console.log('[Maya] Session initialized successfully');
        } catch (error) {
          console.error('[Maya] Failed to initialize session:', error);
        }

        resolve();
      });

      this.socket.on('disconnect', () => {
        if (this._connectionStatus === "connected") {
          this.handleDisconnect();
        }
      });

      this.socket.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(
          new VoxeraError(
            `Socket.IO connection failed: ${error.message}`,
            ErrorCodes.CONNECTION_FAILED
          )
        );
      });

      // Handle all incoming Socket.IO messages
      this.socket.onAny((event, data) => {
        this.handleSignal({ type: event, ...data });
      });
    });
  }

  /**
   * Connect socket.io only — no init-session-connection.
   * Used by multi-room flow where create-room / join-room handle session setup.
   */
  private async connectWebSocketOnly(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.config.serverUrl, {
        transports: ['websocket'],
        reconnection: false,
      });

      const timeout = setTimeout(() => {
        this.socket?.disconnect();
        reject(
          new VoxeraError("Socket.IO connection timeout", ErrorCodes.TIMEOUT)
        );
      }, this.config.connectionOptions?.timeout || 30000);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this.reconnectAttempts = 0;
        console.log('[Maya] Socket connected (no session init)');
        resolve();
      });

      this.socket.on('disconnect', () => {
        if (this._connectionStatus === "connected") {
          this.handleDisconnect();
        }
      });

      this.socket.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(
          new VoxeraError(
            `Socket.IO connection failed: ${error.message}`,
            ErrorCodes.CONNECTION_FAILED
          )
        );
      });

      this.socket.onAny((event, data) => {
        this.handleSignal({ type: event, ...data });
      });
    });
  }

  private async setupWebRTC(session: InitSessionResponse): Promise<void> {
    try {
      // 1. Get RTP capabilities from server
      const rtpCapabilities = await this.emitWithTimeout('getRtpCapabilities', {});
      if (!rtpCapabilities) {
        throw new VoxeraError(
          "Failed to get RTP capabilities",
          ErrorCodes.WEBRTC_ERROR
        );
      }

      // 2. Patch Opus codec for AI audio compatibility (PT-101)
      const opus = rtpCapabilities.codecs.find(
        (c: any) => c.kind === 'audio' && c.mimeType === 'audio/opus'
      );
      if (opus && !rtpCapabilities.codecs.find((c: any) => c.preferredPayloadType === 101)) {
        rtpCapabilities.codecs.push({ ...opus, preferredPayloadType: 101 });
      }

      // 3. Create and load mediasoup Device
      console.log('[Maya] Creating MediaSoup Device...');
      this.device = new mediasoupClient.Device();
      await this.device.load({ routerRtpCapabilities: rtpCapabilities });
      console.log('[Maya] ✅ Device loaded successfully');

      // 4. Get ICE servers configuration
      const iceServers = await this.emitWithTimeout('getIceServers', {});
      console.log('[Maya] ICE servers received:', JSON.stringify(iceServers, null, 2));

      // 5. Create send transport with relay-only policy for STUNner
      const sendParams = await this.emitWithTimeout('createTransport', {});
      console.log('[Maya] Send transport params received:', sendParams);
      console.log('[Maya] ICE servers config:', JSON.stringify(iceServers, null, 2));
      const sendTransportOptions: any = {
        ...sendParams,
        iceServers: iceServers || [{ urls: "stun:stun.l.google.com:19302" }],
        iceTransportPolicy: 'relay', // Force relay-only mode through STUNner (matches working reference)
      };
      console.log('[Maya] Creating send transport with options:', sendTransportOptions);

      this.sendTransport = this.device.createSendTransport(sendTransportOptions);
      console.log('[Maya] ✅ Send transport created, ID:', this.sendTransport.id);

      // Handle send transport connect event
      this.sendTransport.on('connect', ({ dtlsParameters }: any, callback: () => void) => {
        this.socket?.emit('connectTransport', {
          dtlsParameters,
          transportId: this.sendTransport!.id,
        });
        callback();
      });

      // Monitor send transport connection state changes
      this.sendTransport.on('connectionstatechange', (state: string) => {
        console.log('[Maya] 📡 Send transport connection state changed:', state);
        if (state === 'failed' || state === 'closed') {
          console.error('[Maya] ❌ Send transport connection', state, '— audio will not flow. Check STUNner TURN reachability.');
        } else if (state === 'connected') {
          console.log('[Maya] ✅ Send transport ICE/DTLS connected — audio flowing through STUNner.');
        }
      });

      // Handle send transport produce event
      this.sendTransport.on('produce', async ({ kind, rtpParameters }: any, callback: (params: { id: string }) => void, errback: (error: Error) => void) => {
        try {
          const response = await this.socket?.emitWithAck('produce', {
            kind,
            rtpParameters,
            transportId: this.sendTransport!.id,
          });
          // Server may return { error: '...' } instead of throwing — treat it as a failure
          if (!response || response.error) {
            console.error('[Maya] ❌ Server rejected produce:', response?.error ?? 'no response');
            errback(new Error(response?.error ?? 'produce failed: no response from server'));
            return;
          }
          callback({ id: response.id });
        } catch (error) {
          errback(error as Error);
        }
      });

      // 5.5. Produce audio track immediately (this triggers the 'connect' event and establishes TURN connection)
      const audioTrack = this.localStream?.getAudioTracks()[0];
      if (audioTrack) {
        console.log('[Maya] Producing audio track to establish TURN connection...');
        this.audioProducer = await this.sendTransport.produce({ track: audioTrack });
        console.log('[Maya] Audio track produced successfully');
      } else {
        console.warn('[Maya] No audio track available to produce');
      }

      // 5.6. Produce video track if video stream exists
      if (this.localVideoStream) {
        const videoTrack = this.localVideoStream.getVideoTracks()[0];
        if (videoTrack) {
          console.log('[Maya] Producing existing video track...');
          console.log('[Maya] Video track state:', {
            id: videoTrack.id,
            kind: videoTrack.kind,
            label: videoTrack.label,
            enabled: videoTrack.enabled,
            muted: videoTrack.muted,
            readyState: videoTrack.readyState
          });

          // Disable simulcast when video AI is enabled
          const useSimulcast = !this.config.videoConfig?.enableVideoAI;

          this.videoProducer = await this.sendTransport.produce({
            track: videoTrack,
            // Single encoding for AI (PlainTransport), simulcast otherwise
            encodings: useSimulcast ? [
              { maxBitrate: 500000 },
              { maxBitrate: 1000000 },
              { maxBitrate: 1500000 },
            ] : [
              { maxBitrate: 1000000 }, // Single layer for AI capture
            ],
            codecOptions: {
              videoGoogleStartBitrate: 1000,
            },
          });
          console.log('[Maya] Video track produced successfully:', this.videoProducer.id);
          console.log('[Maya] Simulcast:', useSimulcast ? 'enabled (3 layers)' : 'disabled (AI mode)');
          console.log('[Maya] Video producer paused:', this.videoProducer.paused);
          console.log('[Maya] Send transport state:', this.sendTransport.connectionState);

          // Check producer stats after 2 seconds to verify video is flowing
          setTimeout(async () => {
            try {
              if (!this.videoProducer) return;

              const stats = await this.videoProducer.getStats();
              console.log('[Maya] Video producer stats after 2s:', stats);

              // Check if any bytes are being sent
              let bytesSent = 0;
              stats.forEach((report: any) => {
                if (report.type === 'outbound-rtp' && report.bytesSent) {
                  bytesSent = report.bytesSent;
                }
              });

              if (bytesSent === 0) {
                console.error('[Maya] ❌ Video producer NOT sending any data!');
                console.error('[Maya] Track state:', {
                  enabled: videoTrack.enabled,
                  muted: videoTrack.muted,
                  readyState: videoTrack.readyState
                });
                console.error('[Maya] Transport state:', this.sendTransport?.connectionState);
              } else {
                console.log(`[Maya] ✅ Video producer sent ${bytesSent} bytes`);
              }
            } catch (err) {
              console.error('[Maya] Failed to get video producer stats:', err);
            }
          }, 2000);

          // Resume producer if paused
          if (this.videoProducer.paused) {
            console.log('[Maya] Resuming video producer...');
            await this.videoProducer.resume();
            console.log('[Maya] Video producer resumed');
          }
        }
      }

      // 6. Create receive transport for AI audio with relay-only policy
      const recvParams = await this.emitWithTimeout('createTransport', {});
      console.log('[Maya] Recv transport params received:', recvParams);
      const recvTransportOptions: any = {
        ...recvParams,
        iceServers: iceServers || [{ urls: "stun:stun.l.google.com:19302" }],
        iceTransportPolicy: 'relay', // Force relay-only mode through STUNner (matches working reference)
      };
      console.log('[Maya] Creating recv transport with options:', recvTransportOptions);

      this.recvTransport = this.device.createRecvTransport(recvTransportOptions);
      console.log('[Maya] ✅ Recv transport created, ID:', this.recvTransport.id);
      console.log('[Maya] Recv transport connection state:', this.recvTransport.connectionState);

      // Store recv transport globally for debugging
      (window as any).mayaRecvTransport = this.recvTransport;
      console.log('[Maya] Recv transport stored in window.mayaRecvTransport for debugging');

      // Handle receive transport connect event  
      this.recvTransport.on('connect', ({ dtlsParameters }: any, callback: () => void) => {
        console.log('[Maya] 🔗 Recv transport connect event fired, sending DTLS params to server');
        this.socket?.emit('connectTransport', {
          dtlsParameters,
          transportId: this.recvTransport!.id,
        });
        callback();
        console.log('[Maya] ✅ Recv transport connect callback completed');
      });

      // Monitor connection state changes
      this.recvTransport.on('connectionstatechange', (state: any) => {
        console.log('[Maya] 📡 Recv transport connection state changed:', state);
      });

      // 7. Listen for new producers (AI or participant audio/video)
      this.socket?.on('new-producer', async ({ producerId, source, kind, producerClientId }: { producerId: string; source?: string; kind?: string; producerClientId?: string }) => {
        console.log('[Maya] 🎵 New producer detected:', producerId, 'source:', source, 'kind:', kind, 'from:', producerClientId);

        // Clean up old AI consumers and audio elements before creating new one
        if (source === 'ai') {
          console.log('[Maya] 🧹 Cleaning up old AI consumers and audio elements before setting up new one');
          const oldConsumerCount = this.aiConsumers.size;
          const oldAudioCount = this.aiAudioElements.size;

          // Close and remove all old consumers — wait for all to complete
          const closePromises: Promise<void>[] = [];
          this.aiConsumers.forEach((consumer, oldProducerId) => {
            console.log(`[Maya] Closing old AI consumer for producer ${oldProducerId}`);
            closePromises.push(
              new Promise<void>((resolve) => {
                try {
                  consumer.close();
                } catch (e) {
                  console.warn(`[Maya] Error closing consumer:`, e);
                }
                resolve();
              })
            );
          });
          this.aiConsumers.clear();

          // Remove all old audio elements
          this.aiAudioElements.forEach((audioEl, oldProducerId) => {
            console.log(`[Maya] Removing old AI audio element for producer ${oldProducerId}`);
            try {
              audioEl.pause();
              audioEl.srcObject = null;
              // Use more aggressive removal
              if (audioEl.parentNode) {
                audioEl.parentNode.removeChild(audioEl);
              } else {
                audioEl.remove();
              }
            } catch (e) {
              console.warn(`[Maya] Error removing audio element:`, e);
            }
          });
          this.aiAudioElements.clear();

          // Wait for all consumer close operations to finish
          await Promise.all(closePromises);
          console.log(`[Maya] ✅ Cleaned up ${oldConsumerCount} old consumers and ${oldAudioCount} old audio elements`);
        }

        try {
          console.log('[Maya] Requesting to consume producer:', producerId);
          const { id, kind, rtpParameters } = await this.emitWithTimeout('consume', {
            producerId,
            transportId: this.recvTransport!.id,
            rtpCapabilities: this.device!.rtpCapabilities,
          });

          console.log('[Maya] Consumer created - id:', id, 'kind:', kind);
          console.log('[Maya] Consuming on recv transport...');
          const consumer = await this.recvTransport!.consume({
            id,
            producerId,
            kind,
            rtpParameters,
          });

          console.log('[Maya] Consumer created, track:', consumer.track);
          console.log('[Maya] Resuming consumer...');
          await consumer.resume();
          console.log('[Maya] ✅ Consumer resumed');

          // Set up remote audio stream for AI audio
          if (kind === 'audio' && source === 'ai') {
            console.log('[Maya] Setting up AI audio stream');
            // Track this consumer for cleanup later
            this.aiConsumers.set(producerId, consumer);
            this.remoteStream = new MediaStream([consumer.track]);
            this.setupRemoteAudio(this.remoteStream, producerId);
            console.log('[Maya] ✅ AI audio consumer setup complete');
          } else if (kind === 'audio' && source !== 'ai') {
            // Participant audio - set up remote audio playback
            console.log('[Maya] Setting up participant audio stream from:', producerClientId);
            this.participantConsumers.set(producerId, consumer);
            const audioStream = new MediaStream([consumer.track]);
            this.setupRemoteAudio(audioStream, producerId);
            console.log('[Maya] ✅ Participant audio consumer setup complete');
          } else if (kind === 'video') {
            // Participant video
            console.log('[Maya] Setting up participant video stream from:', producerClientId);
            this.participantConsumers.set(producerId, consumer);
            this.remoteVideoStream = new MediaStream([consumer.track]);
            this.emit('video:remote', this.remoteVideoStream);
            console.log('[Maya] ✅ Participant video consumer setup complete');
          } else {
            console.log('[Maya] Unhandled producer kind:', kind, 'source:', source);
          }
        } catch (error) {
          console.error('[Maya] ❌ Error consuming producer:', error);
        }
      });

      // 8. Listen for conversation messages from server
      this.socket?.on('conversation-message', (data: { sessionId: string; role: 'user' | 'assistant'; content: string; timestamp: number; displayName?: string }) => {
        console.log('[Maya] 💬 Conversation message received:', data);

        const messageId = `${data.role}-${data.timestamp}-${Math.random().toString(36).substr(2, 6)}`;

        // Deduplicate — skip if content+role+timestamp match a recent message
        const dedupKey = `${data.role}-${data.timestamp}-${data.content?.slice(0, 50)}`;
        if (this._seenMessageIds.has(dedupKey)) {
          console.log('[Maya] ⏭️ Duplicate message skipped:', dedupKey);
          return;
        }
        this._seenMessageIds.add(dedupKey);

        const message: ConversationMessage = {
          id: messageId,
          role: data.role,
          content: data.content,
          timestamp: new Date(data.timestamp),
          displayName: data.displayName,
        };

        // Add to local messages array
        this._messages.push(message);

        // Emit message event for app to listen to
        this.emit('message', message);
        // Call the onMessage callback (used by React hook)
        this.config.onMessage?.(message);
        console.log('[Maya] ✅ Message added to conversation history, total messages:', this._messages.length);
      });

    } catch (error) {
      throw new VoxeraError(
        `WebRTC setup failed: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCodes.WEBRTC_ERROR
      );
    }
  }

  private async requestMicrophoneAccess(): Promise<void> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Audio track will be produced in setupWebRTC after send transport is created
      // Start audio level monitoring
      this.startAudioLevelMonitoring();
    } catch (error) {
      throw new VoxeraError(
        "Microphone access denied",
        ErrorCodes.MEDIA_ACCESS_DENIED
      );
    }
  }

  private setupRemoteAudio(stream: MediaStream, producerId: string): void {
    console.log('[Maya] Setting up remote AI audio stream for producer:', producerId, stream);

    // Create a unique audio element for each AI producer
    const audioElement = new Audio();
    // Do NOT set autoplay - we use explicit .play() below to avoid double playback
    // Append to DOM - required for audio output in some browsers
    audioElement.style.display = 'none';
    document.body.appendChild(audioElement);
    console.log('[Maya] Created new AI audio element for producer', producerId, 'and attached to DOM');

    // Store reference to this audio element
    this.aiAudioElements.set(producerId, audioElement);

    audioElement.srcObject = stream;

    // Start monitoring AI audio levels
    this.startAIAudioMonitoring(stream);

    // Log track information
    const tracks = stream.getAudioTracks();
    console.log('[Maya] Remote audio stream tracks:', tracks.length, tracks.map(t => ({
      id: t.id,
      label: t.label,
      enabled: t.enabled,
      muted: t.muted,
      readyState: t.readyState,
    })));

    // Add volume control for debugging
    audioElement.volume = 1.0;
    console.log('[Maya] AI audio element volume:', audioElement.volume);

    // Monitor track activity
    const track = tracks[0];
    if (track) {
      // Log initial track state
      console.log('[Maya] Initial track state:', {
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState
      });

      // MediaStreamTrack.muted is read-only and indicates no data is flowing
      // MediaStreamTrack.enabled is writable - ensure it's true
      if (!track.enabled) {
        console.warn('[Maya] Track was disabled, enabling it');
        track.enabled = true;
      }

      track.addEventListener('ended', () => {
        console.log('[Maya] Track ended for producer', producerId);
      });
      track.addEventListener('mute', () => {
        console.warn('[Maya] ⚠️ Track muted for producer', producerId);
      });
      track.addEventListener('unmute', () => {
        console.log('[Maya] ✅ Track unmuted for producer', producerId);
      });

      // Check for audio data every second
      let checkCount = 0;
      const checkInterval = setInterval(() => {
        checkCount++;
        console.log(`[Maya] Audio check #${checkCount} for producer ${producerId}:`, {
          trackReadyState: track.readyState,
          trackEnabled: track.enabled,
          trackMuted: track.muted,
          streamActive: stream.active,
          elementPaused: audioElement.paused,
          elementMuted: audioElement.muted,
          elementVolume: audioElement.volume,
          elementCurrentTime: audioElement.currentTime,
        });

        if (checkCount >= 10 || track.readyState === 'ended') {
          clearInterval(checkInterval);
        }
      }, 500);
    }

    // Clean up audio element when stream ends
    stream.addEventListener('inactive', () => {
      console.log('[Maya] Stream ended for producer', producerId, '- removing audio element');
      audioElement.pause();
      audioElement.srcObject = null;
      audioElement.remove();
      this.aiAudioElements.delete(producerId);
    });

    // Start audio playback - with user interaction handling
    const startAudio = () => {
      console.log('[Maya] Attempting to start audio playback for producer', producerId);
      audioElement.play()
        .then(() => {
          console.log('[Maya] ✅ AI audio playback started successfully for producer', producerId);
          console.log('[Maya] Audio element state - paused:', audioElement.paused, 'muted:', audioElement.muted);
          console.log('[Maya] Audio element currentTime:', audioElement.currentTime, 'duration:', audioElement.duration);
        })
        .catch((error) => {
          console.error('[Maya] ❌ AI audio playback failed:', error);
          if (error.name === 'NotAllowedError') {
            console.warn('[Maya] Browser autoplay policy blocked audio. User interaction required.');
            // Emit warning event to inform UI
            this.emit('warning', {
              type: 'autoplay-blocked',
              message: 'Click anywhere to enable audio playback'
            });
          }
        });
    };

    // If user has already interacted, start immediately
    if (this.hasUserInteracted) {
      console.log('[Maya] User has interacted, starting audio immediately');
      startAudio();
    } else {
      console.log('[Maya] Waiting for user interaction before starting audio');
      this.pendingAudioStarts.push(startAudio);

      // Emit warning that user interaction is needed
      this.emit('warning', {
        type: 'autoplay-blocked',
        message: 'Click anywhere to enable audio playback'
      });
    }
  }

  private startAudioLevelMonitoring(): void {
    if (!this.localStream) return;

    // Create audio context if not exists
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    // Set up analyser for user's microphone
    const source = this.audioContext.createMediaStreamSource(this.localStream);
    this.audioAnalyser = this.audioContext.createAnalyser();
    this.audioAnalyser.fftSize = 1024; // Increased for better accuracy
    this.audioAnalyser.smoothingTimeConstant = 0.3;
    source.connect(this.audioAnalyser);

    const userDataArray = new Uint8Array(this.audioAnalyser.frequencyBinCount);

    /** Calculate RMS (Root Mean Square) volume - more accurate than max */
    const calculateRMS = (dataArray: Uint8Array): number => {
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128; // Normalize to -1 to 1
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      return Math.min(1, rms * 2); // Scale and cap at 1
    };

    this.audioLevelInterval = setInterval(() => {
      if (this.audioAnalyser) {
        this.audioAnalyser.getByteTimeDomainData(userDataArray);
        const level = calculateRMS(userDataArray);
        this.emit("audio:level", level);
        this.config.onAudioLevel?.(level);
      }
    }, 50); // Update more frequently for smoother visualization
  }

  /** Monitor AI audio level from remote stream */
  private startAIAudioMonitoring(stream: MediaStream): void {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    try {
      const source = this.audioContext.createMediaStreamSource(stream);
      this.aiAudioAnalyser = this.audioContext.createAnalyser();
      this.aiAudioAnalyser.fftSize = 1024;
      this.aiAudioAnalyser.smoothingTimeConstant = 0.3;
      source.connect(this.aiAudioAnalyser);

      const aiDataArray = new Uint8Array(this.aiAudioAnalyser.frequencyBinCount);

      const calculateRMS = (dataArray: Uint8Array): number => {
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        return Math.min(1, rms * 2);
      };

      // Stop any existing AI audio level interval
      if (this.aiAudioLevelInterval) {
        clearInterval(this.aiAudioLevelInterval);
      }

      this.aiAudioLevelInterval = setInterval(() => {
        if (this.aiAudioAnalyser) {
          this.aiAudioAnalyser.getByteTimeDomainData(aiDataArray);
          const level = calculateRMS(aiDataArray);
          this.emit('ai-audio:level', level);
          this.config.onAIAudioLevel?.(level);
        }
      }, 50);

      console.log('[Maya] ✅ AI audio monitoring started');
    } catch (error) {
      console.warn('[Maya] Failed to start AI audio monitoring:', error);
    }
  }

  private stopAudioLevelMonitoring(): void {
    if (this.audioLevelInterval) {
      clearInterval(this.audioLevelInterval);
      this.audioLevelInterval = null;
    }
    if (this.aiAudioLevelInterval) {
      clearInterval(this.aiAudioLevelInterval);
      this.aiAudioLevelInterval = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(console.warn);
    }
    this.audioContext = null;
    this.audioAnalyser = null;
    this.aiAudioAnalyser = null;
  }

  private stopLocalStream(): void {
    this.stopAudioLevelMonitoring();
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.localVideoStream) {
      this.localVideoStream.getTracks().forEach((track) => track.stop());
      this.localVideoStream = null;
      this.emit('video:local', null);
      this.config.onLocalVideoStream?.(null);
    }
    if (this.screenShareStream) {
      this.screenShareStream.getTracks().forEach((track) => track.stop());
      this.screenShareStream = null;
      this.emit('screen:local', null);
      this.config.onLocalScreenStream?.(null);
    }
  }

  private sendSignal(signal: Record<string, unknown>): void {
    if (this.socket?.connected) {
      const { type, ...data } = signal;
      this.socket.emit(type as string, data);
    }
  }

  private handleSignal(signal: Record<string, unknown>): void {
    switch (signal.type) {
      case "answer":
        this.handleAnswer(signal);
        break;
      case "ice-candidate":
        this.handleIceCandidate(signal);
        break;
      case "transcript":
        this.handleTranscript(signal);
        break;
      case "speaking:status":
        this.handleSpeakingStatus(signal);
        break;
      case "error":
        this.handleServerError(signal);
        break;
    }
  }

  // Note: handleAnswer and handleIceCandidate are not used with mediasoup
  // Mediasoup uses a different signaling flow via Socket.IO emitWithAck
  private async handleAnswer(signal: Record<string, unknown>): Promise<void> {
    // Not used with mediasoup - kept for compatibility
  }

  private async handleIceCandidate(
    signal: Record<string, unknown>
  ): Promise<void> {
    // Not used with mediasoup - kept for compatibility
  }

  private handleMessage(signal: Record<string, unknown>): void {
    const message = signal.message as ConversationMessage;
    if (message) {
      message.timestamp = new Date(message.timestamp);
      this._messages.push(message);
      this.emit("message", message);
      this.config.onMessage?.(message);
    }
  }

  private handleTranscript(signal: Record<string, unknown>): void {
    const text = signal.text as string;
    const isFinal = signal.isFinal as boolean;
    this.emit("transcript", text, isFinal);
    this.config.onTranscript?.(text, isFinal);
  }

  private handleSpeakingStatus(signal: Record<string, unknown>): void {
    const status = signal.status as SpeakingStatus;
    this.setSpeakingStatus(status);
  }

  private handleServerError(signal: Record<string, unknown>): void {
    const error = new VoxeraError(
      (signal.message as string) || "Server error",
      (signal.code as string) || ErrorCodes.SERVER_ERROR
    );
    this.handleError(error);
  }

  private handleDisconnect(): void {
    if (
      this.config.connectionOptions?.autoReconnect &&
      this.reconnectAttempts <
      (this.config.connectionOptions?.reconnectAttempts || 3)
    ) {
      this.setConnectionStatus("reconnecting");
      this.reconnectAttempts++;

      // Invalidate old WebRTC resources before reconnecting
      // so connect() creates fresh transports and producers
      if (this.audioProducer) {
        try { this.audioProducer.close(); } catch (_) { }
        this.audioProducer = null;
      }
      if (this.videoProducer) {
        try { this.videoProducer.close(); } catch (_) { }
        this.videoProducer = null;
      }
      if (this.sendTransport) {
        try { this.sendTransport.close(); } catch (_) { }
        this.sendTransport = null;
      }
      if (this.recvTransport) {
        try { this.recvTransport.close(); } catch (_) { }
        this.recvTransport = null;
      }
      this.device = null;

      // Exponential backoff with jitter
      const baseDelay = this.config.connectionOptions?.reconnectDelay || 1000;
      const maxDelay = 30000;
      const exponentialDelay = baseDelay * Math.pow(2, this.reconnectAttempts - 1);
      const jitter = Math.random() * baseDelay;
      const delay = Math.min(exponentialDelay + jitter, maxDelay);

      setTimeout(() => {
        this.connect().then(() => {
          // Reset reconnect counter on successful reconnect
          this.reconnectAttempts = 0;
        }).catch(() => {
          // Reconnect failed — handleDisconnect will be called again by socket
        });
      }, delay);
    } else {
      this.setConnectionStatus("disconnected");
    }
  }

  private handleError(error: Error): void {
    const mayaError =
      error instanceof VoxeraError
        ? error
        : new VoxeraError(error.message, ErrorCodes.UNKNOWN_ERROR);

    this.emit("error", mayaError);
    this.config.onError?.(mayaError);
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    if (this._connectionStatus !== status) {
      this._connectionStatus = status;
      this.emit("connection:status", status);
      this.config.onConnectionStatusChange?.(status);
    }
  }

  private setConversationStatus(status: ConversationStatus): void {
    if (this._conversationStatus !== status) {
      this._conversationStatus = status;
      this.emit("conversation:status", status);
      this.config.onConversationStatusChange?.(status);
    }
  }

  private setSpeakingStatus(status: SpeakingStatus): void {
    if (this._speakingStatus !== status) {
      this._speakingStatus = status;
      this.emit("speaking:status", status);
      this.config.onSpeakingStatusChange?.(status);
    }
  }

  private cleanup(): void {
    // Stop local stream
    this.stopLocalStream();

    // Close Socket.IO
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    // Close producers
    if (this.audioProducer) {
      this.audioProducer.close();
      this.audioProducer = null;
    }
    if (this.videoProducer) {
      this.videoProducer.close();
      this.videoProducer = null;
    }
    if (this.screenShareProducer) {
      this.screenShareProducer.close();
      this.screenShareProducer = null;
    }

    // Close mediasoup transports
    if (this.sendTransport) {
      this.sendTransport.close();
      this.sendTransport = null;
    }

    if (this.recvTransport) {
      this.recvTransport.close();
      this.recvTransport = null;
    }

    // Close participant consumers
    this.participantConsumers.forEach((consumer) => {
      try { consumer.close(); } catch (_) {}
    });
    this.participantConsumers.clear();

    // Close AI consumers
    this.aiConsumers.forEach((consumer) => {
      try { consumer.close(); } catch (_) {}
    });
    this.aiConsumers.clear();

    // Remove AI audio elements
    this.aiAudioElements.forEach((audioEl) => {
      try {
        audioEl.pause();
        audioEl.srcObject = null;
        audioEl.remove();
      } catch (_) {}
    });
    this.aiAudioElements.clear();

    // Clear device
    this.device = null;

    // Clear messages
    this._messages = [];
    this._seenMessageIds.clear();
    this._sessionId = null;

    // Clear meeting state
    this._roomMode = null;
    this._isHost = false;
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Emit with acknowledgement and a timeout to prevent indefinite hangs.
   * If the server doesn't respond within `timeoutMs`, rejects with an error.
   */
  private emitWithTimeout<T = any>(event: string, data: any, timeoutMs = 10000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new VoxeraError(
          `Server did not respond to '${event}' within ${timeoutMs}ms`,
          ErrorCodes.CONNECTION_FAILED
        ));
      }, timeoutMs);

      this.socket?.emitWithAck(event, data).then((result: T) => {
        clearTimeout(timer);
        resolve(result);
      }).catch((err: any) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
