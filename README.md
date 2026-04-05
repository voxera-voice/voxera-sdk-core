# @voxera/sdk-core

Core TypeScript SDK for the [Voxera](https://voxera.ai) voice AI platform. Handles WebRTC connections via mediasoup, Socket.IO signaling, and voice AI interactions.

## Installation

```bash
npm install @voxera/sdk-core
```

## Quick Start

```typescript
import { VoxeraClient } from '@voxera/sdk-core';

const client = new VoxeraClient({
  appKey: 'your-api-key',
  serverUrl: 'wss://api.voxera.ai',
  chatConfig: {
    systemPrompt: 'You are a helpful assistant.',
  },
});

// Connect and start a voice conversation
await client.connect();
await client.startConversation();

// Listen for AI responses
client.on('message', (msg) => {
  console.log(`${msg.role}: ${msg.content}`);
});

// Listen for status changes
client.on('connection:status', (status) => console.log('Connection:', status));
client.on('speaking:status', (status) => console.log('Speaking:', status));
```

## Features

- **Voice AI Conversations** — real-time voice chat with AI (OpenAI, Anthropic, Ollama)
- **Multi-Room Meetings** — create/join rooms with multiple participants
- **AI Meetings** — rooms with built-in AI assistant, live transcription, summaries
- **Peer Video & Audio** — bidirectional video/audio streaming via mediasoup
- **Screen Sharing** — share screen/tab with optional AI analysis
- **Host Controls** — mute, remove, lock, transfer host, waiting room
- **Live Transcription** — real-time speech-to-text for all participants
- **Transcribe-Only Mode** — transcription without AI processing
- **Meeting Intelligence** — AI-generated summaries, minutes, bookmarks
- **TypeScript-first** — full type definitions for all APIs and events

## API Reference

### `VoxeraClient`

#### Constructor

```typescript
const client = new VoxeraClient(config: VoxeraConfig);
```

#### Configuration

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `appKey` | `string` | ✅ | API key from Voxera dashboard |
| `serverUrl` | `string` | ✅ | WebSocket server URL |
| `sessionToken` | `string` | | Pre-authenticated session token |
| `configurationId` | `string` | | Server-side AI configuration ID |
| `chatConfig` | `ChatConfig` | | AI chat settings (prompt, model, provider) |
| `voiceConfig` | `VoiceConfig` | | TTS voice settings (provider, voiceId, language) |
| `videoConfig` | `VideoConfig` | | Camera settings (resolution, frameRate) |
| `connectionOptions` | `ConnectionOptions` | | Reconnect settings, ICE servers |

#### Core Methods

| Method | Description |
|--------|-------------|
| `connect()` | Connect to server, initialize session, set up WebRTC |
| `disconnect()` | Disconnect and clean up all resources |
| `startConversation()` | Start a voice AI conversation |
| `endConversation()` | End the current conversation |
| `sendMessage(content)` | Send a text message |
| `setMuted(muted)` | Mute/unmute local microphone |

#### Video Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `enableVideo()` | `void` | Enable camera |
| `disableVideo()` | `void` | Disable camera |
| `toggleVideo()` | `boolean` | Toggle camera, returns new state |
| `startScreenShare()` | `void` | Start screen sharing |
| `stopScreenShare()` | `void` | Stop screen sharing |
| `toggleScreenShare()` | `boolean` | Toggle screen share, returns new state |

#### Room Methods

| Method | Description |
|--------|-------------|
| `connectSocket()` | Connect socket only (for multi-room flows) |
| `setupRoomWebRTC()` | Set up microphone + WebRTC after joining a room |

#### Host Controls (meeting host only)

| Method | Description |
|--------|-------------|
| `muteParticipant(sessionId, targetClientId)` | Mute a participant |
| `muteAll(sessionId)` | Mute all participants |
| `unmuteAll(sessionId)` | Unmute all participants |
| `removeParticipant(sessionId, targetClientId)` | Remove a participant |
| `lockRoom(sessionId, locked)` | Lock/unlock the room |
| `endMeeting(sessionId)` | End the meeting for all |
| `transferHost(sessionId, targetClientId)` | Transfer host role |

#### Transcription & AI

| Method | Description |
|--------|-------------|
| `toggleTranscription(sessionId, enabled)` | Toggle live transcription |
| `toggleTranscribeOnly(sessionId, enabled)` | Transcription without AI processing |
| `askAi(sessionId)` | Trigger AI to process transcript |
| `cancelAskAi(sessionId)` | Cancel AI request |
| `askAiText(sessionId, prompt?)` | Ask AI a text question |
| `generateSummary(sessionId)` | Generate meeting summary |
| `generateMinutes(sessionId)` | Generate meeting minutes |
| `addBookmark(sessionId, label, isActionItem?)` | Add a bookmark |

### Events

Listen to events via `client.on(event, handler)`:

```typescript
// Connection & conversation
client.on('connection:status', (status: ConnectionStatus) => {});
client.on('conversation:status', (status: ConversationStatus) => {});
client.on('speaking:status', (status: SpeakingStatus) => {});
client.on('message', (msg: ConversationMessage) => {});
client.on('transcript', (text: string, isFinal: boolean) => {});
client.on('error', (error: VoxeraError) => {});

// Audio levels
client.on('audio:level', (level: number) => {});
client.on('ai-audio:level', (level: number) => {});
client.on('peer-audio:level', ({ producerId, clientId, level }) => {});

// Video
client.on('video:local', (stream: MediaStream | null) => {});
client.on('video:remote', (stream: MediaStream | null) => {});
client.on('peer-video:stream', ({ producerId, clientId, stream }) => {});

// Meeting events
client.on('participant:joined', ({ clientId, displayName, participants }) => {});
client.on('participant:left', ({ clientId, displayName, participants }) => {});
client.on('host:changed', ({ newHostClientId, newHostName }) => {});
client.on('meeting:ended', ({ by }) => {});
client.on('transcription:live', (entry: TranscriptionEntry) => {});
client.on('transcribe-only:toggled', ({ enabled, by }) => {});
```

### Error Handling

```typescript
import { VoxeraError, ErrorCodes } from '@voxera/sdk-core';

client.on('error', (error: VoxeraError) => {
  switch (error.code) {
    case ErrorCodes.AUTHENTICATION_FAILED:
      console.error('Invalid API key');
      break;
    case ErrorCodes.MEDIA_ACCESS_DENIED:
      console.error('Microphone permission denied');
      break;
    case ErrorCodes.CONNECTION_FAILED:
      console.error('Connection failed');
      break;
  }
});
```

## Multi-Room Example

```typescript
const client = new VoxeraClient({ appKey: '...', serverUrl: '...' });
await client.connectSocket();

// Create an AI meeting room
const socket = client.getSocket();
const result = await socket.emitWithAck('create-room', {
  displayName: 'Alice',
  roomMode: 'ai-meeting',
});

// Set up WebRTC after room creation
client.setRoomInfo('ai-meeting', true);
await client.setupRoomWebRTC();
```

## TypeScript Types

All types are fully exported:

```typescript
import type {
  VoxeraConfig,
  VoxeraEvents,
  ConnectionStatus,
  ConversationStatus,
  ConversationMessage,
  RoomMode,
  RoomParticipant,
  TranscriptionEntry,
  MeetingBookmark,
  MeetingSummary,
  MeetingMinutes,
} from '@voxera/sdk-core';
```

## License

MIT
