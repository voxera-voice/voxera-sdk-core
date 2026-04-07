/**
 * Voxera SDK Core
 *
 * The core SDK for connecting to the Voxera Voice platform.
 * Provides WebRTC-based voice AI interactions.
 *
 * 
 * 
 * 
 * 
 * @example
 * ```typescript
 * import { MayaVoiceClient } from '@voxera/sdk-core';
 *
 * const client = new MayaVoiceClient({
 *   appKey: 'your-api-key',
 *   serverUrl: 'wss://media.voxera-voice.com',
 *   chatConfig: {
 *     systemPrompt: 'You are a helpful assistant.',
 *   },
 * });
 *
 * await client.connect();
 * await client.startConversation();
 * ```
 */

export { MayaVoiceClient } from "./client";
export { MayaVoiceClient as VoxeraClient } from "./client";

export {
  // Types
  type MayaVoiceConfig,
  type ChatConfig,
  type VoiceConfig,
  type VideoConfig,
  type ScreenShareConfig,
  type ConnectionOptions,
  type ConversationMessage,
  type MayaVoiceEvents,
  type WebRTCStats,
  type Session,
  type InitSessionResponse,
  type ValidateSessionResponse,

  // Status Types
  type ConnectionStatus,
  type ConversationStatus,
  type SpeakingStatus,
  type ErrorCode,

  // Meeting Types
  type RoomMode,
  type RoomParticipant,
  type TranscriptionEntry,
  type WaitingRoomEntry,
  type RoomInfo,
  type MeetingCallbacks,

  // Phase 2: AI Differentiator Types
  type MeetingBookmark,
  type MeetingSummary,
  type MeetingMinutes,
  type MeetingMinutesSection,
  type MeetingMinutesActionItem,

  // Error
  MayaVoiceError,
  ErrorCodes,
} from "./types";

// Version
export const VERSION = "1.0.0";
