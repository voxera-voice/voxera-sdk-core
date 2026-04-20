/**
 * Maya Voice SDK Core Types
 */

// Room / Meeting Modes
export type RoomMode = "ai-meeting" | "normal-meeting";

// Connection and Status
export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type ConversationStatus =
  | "idle"
  | "starting"
  | "active"
  | "ending"
  | "ended";

export type SpeakingStatus = "user" | "ai" | "none";

// Message Types
export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

// Configuration
export interface VoxeraConfig {
  // Required
  appKey: string;
  serverUrl: string;

  // Optional
  sessionToken?: string;
  /** @deprecated Use agentId instead */
  configurationId?: string;
  agentId?: string;
  userId?: string;
  metadata?: Record<string, string>;

  // Video configuration (client-side media constraints)
  videoConfig?: VideoConfig;

  // AI chat configuration (optional — overridden by server-side agent config)
  chatConfig?: ChatConfig;

  // Voice / TTS configuration (optional — overridden by server-side agent config)
  voiceConfig?: VoiceConfig;

  // Connection options
  connectionOptions?: ConnectionOptions;

  // Callbacks
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
  onConversationStatusChange?: (status: ConversationStatus) => void;
  onSpeakingStatusChange?: (status: SpeakingStatus) => void;
  onMessage?: (message: ConversationMessage) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: VoxeraError) => void;
  onAudioLevel?: (level: number) => void;
  onAIAudioLevel?: (level: number) => void;
  onLocalVideoStream?: (stream: MediaStream | null) => void;
  onRemoteVideoStream?: (stream: MediaStream | null) => void;
  onLocalScreenStream?: (stream: MediaStream | null) => void;

  // Screen sharing configuration
  screenShareConfig?: ScreenShareConfig;
}

export interface ChatConfig {
  systemPrompt?: string;
  welcomeMessage?: string;
  aiProvider?: "openai" | "anthropic" | "ollama";
  model?: string;
  temperature?: number;
  maxTokens?: number;
  contextMessages?: ConversationMessage[];
}

export interface VoiceConfig {
  voiceId?: string;
  voiceProvider?: "elevenlabs" | "openai" | "azure";
  language?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

export interface VideoConfig {
  enabled?: boolean;
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: "user" | "environment";
  enableVideoAI?: boolean; // Enable server-side video frame capture for AI
}

export interface ScreenShareConfig {
  /** Max width of captured screen (default: 1920) */
  width?: number;
  /** Max height of captured screen (default: 1080) */
  height?: number;
  /** Frame rate for screen capture (default: 15) */
  frameRate?: number;
  /** Include system/tab audio alongside screen (default: false) */
  audio?: boolean;
  /** Send screen frames to server-side AI pipeline (default: false) */
  enableVideoAI?: boolean;
}

export interface ConnectionOptions {
  autoReconnect?: boolean;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  timeout?: number;
  iceServers?: RTCIceServer[];
}

// Events
export interface VoxeraEvents {
  "connection:status": (status: ConnectionStatus) => void;
  "conversation:status": (status: ConversationStatus) => void;
  "speaking:status": (status: SpeakingStatus) => void;
  message: (message: ConversationMessage) => void;
  transcript: (text: string, isFinal: boolean) => void;
  error: (error: VoxeraError) => void;
  warning: (warning: { type: string; message: string }) => void;
  "audio:level": (level: number) => void;
  "ai-audio:level": (level: number) => void;
  "video:local": (stream: MediaStream | null) => void;
  "video:remote": (stream: MediaStream | null) => void;
  "screen:local": (stream: MediaStream | null) => void;
  // Meeting events
  "participant:joined": (data: { clientId: string; displayName: string; participants: RoomParticipant[] }) => void;
  "participant:left": (data: { clientId: string; displayName: string; participants: RoomParticipant[] }) => void;
  "participant:removed": (data: { clientId: string; displayName: string; participants: RoomParticipant[] }) => void;
  "participants:updated": (data: { participants: RoomParticipant[] }) => void;
  "you:muted": (data: { by: string }) => void;
  "you:removed": (data: { by: string }) => void;
  "host:changed": (data: { newHostClientId: string; newHostName: string }) => void;
  "meeting:ended": (data: { by: string }) => void;
  "room:locked": (data: { locked: boolean; by: string }) => void;
  "transcription:toggled": (data: { enabled: boolean; by: string }) => void;
  "transcription:live": (entry: TranscriptionEntry) => void;
  "ask-ai:started": (data: { requesterId: string; requesterName: string }) => void;
  "ask-ai:processing": () => void;
  "ask-ai:cancelled": (data: { by: string }) => void;
  // Phase 3: Text-only AI events (normal-meeting mode)
  "ask-ai-text:started": (data: { requesterId: string; requesterName: string }) => void;
  "ask-ai-text:chunk": (data: { token: string; requesterId: string }) => void;
  "ask-ai-text:response": (data: { text: string; requestedBy: string; requesterId: string }) => void;
  "ask-ai-text:error": (data: { error: string }) => void;
  "waiting-room:status": (data: { sessionId: string; roomCode: string; message: string }) => void;
  "waiting-room:admitted": (data: { sessionId: string; roomMode?: RoomMode }) => void;
  "waiting-room:denied": (data: { sessionId: string }) => void;
  "waiting-room:updated": (data: { waitingRoom: WaitingRoomEntry[] }) => void;
  "waiting-room:toggled": (data: { enabled: boolean }) => void;
  // Phase 2: AI Differentiator events
  "summary:generating": (data: { requestedBy: string }) => void;
  "summary:generated": (summary: MeetingSummary) => void;
  "minutes:generating": (data: { requestedBy: string }) => void;
  "minutes:generated": (minutes: MeetingMinutes) => void;
  "bookmark:added": (bookmark: MeetingBookmark) => void;
  "bookmark:removed": (data: { bookmarkId: string }) => void;
}

// Error
export class VoxeraError extends Error {
  public code: string;
  public details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "VoxeraError";
    this.code = code;
    this.details = details;
  }
}

// Error codes
export const ErrorCodes = {
  CONNECTION_FAILED: "CONNECTION_FAILED",
  AUTHENTICATION_FAILED: "AUTHENTICATION_FAILED",
  WEBRTC_ERROR: "WEBRTC_ERROR",
  MEDIA_ACCESS_DENIED: "MEDIA_ACCESS_DENIED",
  TIMEOUT: "TIMEOUT",
  SERVER_ERROR: "SERVER_ERROR",
  INVALID_CONFIG: "INVALID_CONFIG",
  NETWORK_ERROR: "NETWORK_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// WebRTC Types
export interface WebRTCStats {
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsSent: number;
  roundTripTime?: number;
  jitter?: number;
  audioLevel?: number;
}

// Session Types
export interface Session {
  id: string;
  status: "active" | "ended";
  startedAt: Date;
  endedAt?: Date;
  metadata?: Record<string, unknown>;
}

// API Response Types
export interface InitSessionResponse {
  success: boolean;
  data?: {
    sessionId: string;
    conversationId: string;
    configuration: SessionConfiguration;
    organization: {
      id: string;
      name: string;
      plan: string;
    };
    usage: {
      usedMinutes: number;
      maxMinutes: number;
    };
    encryptionKey?: string;
  };
  error?: {
    code: string;
    message: string;
  };
  // Legacy fields for backward compatibility
  sessionId?: string;
  sessionToken?: string;
  iceServers?: RTCIceServer[];
  mediaServerUrl?: string;
}

export interface SessionConfiguration {
  id: string;
  name: string;
  aiProvider: string;
  aiModel: string;
  voiceProvider: string;
  voiceId: string;
  language: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

export interface ValidateSessionResponse {
  valid: boolean;
  session?: Session;
}

// ─── Meeting / Room Types ──────────────────────────────────────────────

export interface RoomParticipant {
  id: string;
  name: string;
  userId?: string;
  isMuted: boolean;
  isSpeaking: boolean;
  sessionId: string;
}

export interface TranscriptionEntry {
  clientId: string;
  displayName: string;
  text: string;
  timestamp: number;
}

export interface WaitingRoomEntry {
  clientId: string;
  socketId: string;
  displayName: string;
  joinedAt: Date;
}

export interface RoomInfo {
  sessionId: string;
  roomCode: string;
  roomMode: RoomMode;
  isHost: boolean;
  participants: RoomParticipant[];
}

// Meeting event callback types
export interface MeetingCallbacks {
  onParticipantJoined?: (data: { clientId: string; displayName: string; participants: RoomParticipant[] }) => void;
  onParticipantLeft?: (data: { clientId: string; displayName: string; participants: RoomParticipant[] }) => void;
  onParticipantRemoved?: (data: { clientId: string; displayName: string; participants: RoomParticipant[] }) => void;
  onParticipantsUpdated?: (data: { participants: RoomParticipant[] }) => void;
  onYouWereMuted?: (data: { by: string }) => void;
  onYouWereRemoved?: (data: { by: string }) => void;
  onAllMuted?: (data: { by: string }) => void;
  onAllUnmuted?: (data: { by: string }) => void;
  onHostChanged?: (data: { newHostClientId: string; newHostName: string }) => void;
  onMeetingEnded?: (data: { by: string }) => void;
  onRoomLockedChanged?: (data: { locked: boolean; by: string }) => void;
  onTranscriptionToggled?: (data: { enabled: boolean; by: string }) => void;
  onLiveTranscription?: (entry: TranscriptionEntry) => void;
  onAskAiStarted?: (data: { requesterId: string; requesterName: string }) => void;
  onAskAiProcessing?: () => void;
  onAskAiCancelled?: (data: { by: string }) => void;
  // Phase 3: Text-only AI callbacks
  onAskAiTextStarted?: (data: { requesterId: string; requesterName: string }) => void;
  onAskAiTextChunk?: (data: { token: string; requesterId: string }) => void;
  onAskAiTextResponse?: (data: { text: string; requestedBy: string; requesterId: string }) => void;
  onAskAiTextError?: (data: { error: string }) => void;
  onWaitingRoom?: (data: { sessionId: string; roomCode: string; message: string }) => void;
  onAdmitted?: (data: { sessionId: string; roomMode?: RoomMode }) => void;
  onDenied?: (data: { sessionId: string }) => void;
  onWaitingRoomUpdated?: (data: { waitingRoom: WaitingRoomEntry[] }) => void;
  onWaitingRoomToggled?: (data: { enabled: boolean }) => void;
  // Phase 2: AI Differentiators
  onSummaryGenerating?: (data: { requestedBy: string }) => void;
  onSummaryGenerated?: (summary: MeetingSummary) => void;
  onMinutesGenerating?: (data: { requestedBy: string }) => void;
  onMinutesGenerated?: (minutes: MeetingMinutes) => void;
  onBookmarkAdded?: (bookmark: MeetingBookmark) => void;
  onBookmarkRemoved?: (data: { bookmarkId: string }) => void;
}

// ─── Phase 2: AI Differentiator Types ──────────────────────────────────

export interface MeetingBookmark {
  id: string;
  clientId: string;
  displayName: string;
  label: string;
  timestamp: number;
  conversationIndex: number;
  isActionItem: boolean;
}

export interface MeetingSummary {
  id: string;
  sessionId: string;
  generatedAt: number;
  summary: string;
  actionItems: string[];
  keyTopics: string[];
  requestedBy: string;
}

export interface MeetingMinutes {
  id: string;
  sessionId: string;
  generatedAt: number;
  title: string;
  attendees: string[];
  duration: number;
  sections: MeetingMinutesSection[];
  actionItems: MeetingMinutesActionItem[];
  rawTranscript: string;
}

export interface MeetingMinutesSection {
  heading: string;
  content: string;
}

export interface MeetingMinutesActionItem {
  task: string;
  assignee?: string;
  dueDate?: string;
}
