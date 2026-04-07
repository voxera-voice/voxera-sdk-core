/**
 * Voxera SDK Core
 *
 * The core SDK for connecting to the Voxera Voice platform.
 * Provides WebRTC-based voice AI interactions.
 *
 * @example
 * ```typescript
 * import { VoxeraClient } from '@voxera/sdk-core';
 *
 * const client = new VoxeraClient({
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

export { VoxeraClient } from "./client";

export {
  // Types
  type VoxeraConfig,
  type ChatConfig,
  type VoiceConfig,
  type VideoConfig,
  type ScreenShareConfig,
  type ConnectionOptions,
  type ConversationMessage,
  type VoxeraEvents,
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
  VoxeraError,
  ErrorCodes,
} from "./types";

// Backward-compatible aliases
export { VoxeraClient as MayaVoiceClient } from "./client";
export { VoxeraError as MayaVoiceError } from "./types";
export type { VoxeraConfig as MayaVoiceConfig } from "./types";
export type { VoxeraEvents as MayaVoiceEvents } from "./types";

// Version
export const VERSION = "1.0.0";
