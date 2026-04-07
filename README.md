# Voxera SDK — Core

Core TypeScript SDK for [Voxera Voice Platform](https://voxera-voice.com). Platform-agnostic client library that powers all framework-specific SDKs (React, React Native, iOS, Android, Flutter).

## Platform Endpoints

| Service | URL |
|---------|-----|
| **Media Server (WebSocket)** | `wss://media.voxera-voice.com` |
| **Demo** | `https://demo.voxera-voice.com` |

> Pass the Media Server URL as `serverUrl` when creating a client. Get your API key at [app.voxera-voice.com](https://app.voxera-voice.com).

## Meeting Modes

### AI Meeting (`ai-meeting`)

A real-time voice conversation with an AI assistant. The AI listens via speech-to-text (STT), processes through a configurable LLM (OpenAI, Anthropic, Ollama), and responds with natural speech via text-to-speech (TTS). Supports multiple participants talking to the same AI in a shared room.

**Capabilities:**

- Real-time voice AI conversation (bidirectional audio over WebRTC/mediasoup)
- Configurable AI persona via dashboard Agent settings (system prompt, model, temperature, max tokens)
- Multiple TTS providers (OpenAI, ElevenLabs, Azure) with voice selection
- Multiple STT providers (Google, OpenAI Whisper)
- Live transcription of all speakers
- Video and screen sharing with optional AI vision (`enableVideoAI`)
- Ask AI — send the current transcript to AI and get a spoken response
- Text message input alongside voice
- AI-generated meeting summaries with action items and key topics
- AI-generated meeting minutes (title, attendees, duration, sections)
- Bookmarks — mark key moments and flag as action items

### Normal Meeting (`normal-meeting`)

A multi-participant audio/video meeting **without** AI voice. Participants talk to each other via WebRTC. AI features are available in text-only form.

**Capabilities:**

- Multi-participant real-time audio and video (WebRTC/mediasoup SFU)
- Host controls — mute/unmute participant, mute all, remove participant, transfer host, lock room, end meeting
- Waiting room — enable/disable, admit or deny individual participants, admit all
- Live transcription (toggle on/off by host)
- Ask AI (text) — send a prompt to AI, receive a streamed text response (no voice)
- AI-generated meeting summaries and minutes
- Bookmarks
- Screen sharing

### Common Features (Both Modes)

- **WebRTC via mediasoup** — SFU-based low-latency audio/video transport with TURN fallback
- **Room management** — create rooms with codes, join by code, display names, participant list
- **Real-time events** — participant join/leave, mute status, host changes, room lock, transcription entries
- **Webhook integration** — receive server-side events on session start/end, messages, errors
- **Usage tracking** — minutes consumed, session history, breakdowns by period
- **Configurable** — override AI provider, voice, language, video resolution per session

## Installation

```bash
npm install @voxera/sdk-core
```

## Quick Start

```typescript
import { MayaVoiceClient } from '@voxera/sdk-core';

const client = new MayaVoiceClient({
  appKey: 'your-app-key',                    // from https://app.voxera-voice.com
  serverUrl: 'wss://media.voxera-voice.com',
  agentId: 'your-agent-id',                  // created in the dashboard
  onConnectionStatusChange: (status) => console.log('Connection:', status),
  onMessage: (msg) => console.log('Message:', msg),
  onTranscript: (text, isFinal) => console.log('Transcript:', text),
});

// Connect and start AI conversation
await client.connect();
await client.startConversation();

// Later
await client.endConversation();
client.disconnect();
```

### Multi-Participant Room

```typescript
// Host creates a room
await client.connect();
const room = await client.createRoom('Alice', 'Team Standup', 'normal-meeting');
console.log('Room code:', room.roomCode); // share this code

// Another user joins
await otherClient.connect();
await otherClient.joinRoom(room.roomCode, 'Bob');

// Host controls
await client.muteParticipant(sessionId, targetClientId);
await client.lockRoom(sessionId, true);
await client.toggleTranscription(sessionId, true);

// AI features (text-only in normal-meeting mode)
await client.askAiText(sessionId, 'Summarize what was discussed');
await client.generateSummary(sessionId);
await client.generateMinutes(sessionId);
await client.addBookmark(sessionId, 'Key decision made', true);
```

## Configuration

### `MayaVoiceConfig`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `appKey` | `string` | Yes | API key from the dashboard |
| `serverUrl` | `string` | Yes | `wss://media.voxera-voice.com` |
| `agentId` | `string` | No | Agent ID (created in the dashboard). Defines AI persona, model, voice, tools, and endpoints |
| `userId` | `string` | No | Identify the end-user for analytics |
| `metadata` | `Record<string, string>` | No | Custom key-value pairs passed to agent endpoints |
| `videoConfig` | `VideoConfig` | No | Camera/video settings |
| `screenShareConfig` | `ScreenShareConfig` | No | Screen share settings |
| `connectionOptions` | `ConnectionOptions` | No | Reconnect/timeout settings |

### `VideoConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable video on connect |
| `width` | `number` | `640` | Video width |
| `height` | `number` | `480` | Video height |
| `frameRate` | `number` | `30` | Frames per second |
| `facingMode` | `string` | `user` | `user` (front) · `environment` (back) |
| `enableVideoAI` | `boolean` | `false` | Send video frames to AI pipeline |

### `ConnectionOptions`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `autoReconnect` | `boolean` | `true` | Auto-reconnect on disconnect |
| `reconnectAttempts` | `number` | `5` | Max reconnect attempts |
| `reconnectDelay` | `number` | `1000` | Delay between attempts (ms) |
| `timeout` | `number` | `10000` | Connection timeout (ms) |
| `iceServers` | `RTCIceServer[]` | — | Custom ICE/TURN servers |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `connection:status` | `ConnectionStatus` | `idle` → `connecting` → `connected` → `disconnected` |
| `conversation:status` | `ConversationStatus` | `idle` → `starting` → `active` → `ending` → `ended` |
| `speaking:status` | `SpeakingStatus` | `none` · `user` · `ai` |
| `message` | `ConversationMessage` | New chat message |
| `transcript` | `(text, isFinal)` | Real-time speech transcription |
| `participant:joined` | `RoomParticipant` | Someone joined the room |
| `participant:left` | `RoomParticipant` | Someone left the room |
| `participants:updated` | `RoomParticipant[]` | Full participant list update |
| `you:muted` | — | You were muted by the host |
| `you:removed` | — | You were removed from the room |
| `host:changed` | — | Host was transferred |
| `meeting:ended` | — | Meeting ended by host |
| `room:locked` | `boolean` | Room lock status changed |
| `transcription:toggled` | `boolean` | Transcription toggled by host |
| `transcription:live` | `TranscriptionEntry` | Live transcription entry |
| `ask-ai:started` | — | AI voice response started |
| `ask-ai:processing` | — | AI is processing |
| `ask-ai:cancelled` | — | AI voice response cancelled |
| `ask-ai-text:started` | — | AI text response started |
| `ask-ai-text:chunk` | `string` | Streamed AI text chunk |
| `ask-ai-text:response` | `string` | Complete AI text response |
| `summary:generated` | `MeetingSummary` | AI summary ready |
| `minutes:generated` | `MeetingMinutes` | AI minutes ready |
| `bookmark:added` | `MeetingBookmark` | Bookmark created |
| `bookmark:removed` | `string` | Bookmark removed (ID) |
| `waiting-room:updated` | `WaitingRoomEntry[]` | Waiting room list changed |
| `waiting-room:toggled` | `boolean` | Waiting room enabled/disabled |

## Methods

### Connection

| Method | Description |
|--------|-------------|
| `connect()` | Connect to the media server |
| `disconnect()` | Disconnect and clean up |
| `connectSocketOnly()` | Connect socket without WebRTC (for room setup) |
| `setupRoomWebRTC()` | Initialize WebRTC after joining a room |

### Conversation

| Method | Description |
|--------|-------------|
| `startConversation()` | Start voice conversation |
| `endConversation()` | End voice conversation |
| `sendMessage(content)` | Send a text message |

### Media

| Method | Description |
|--------|-------------|
| `setMuted(muted)` | Mute/unmute microphone |
| `enableVideo()` | Start camera |
| `disableVideo()` | Stop camera |
| `toggleVideo()` | Toggle camera on/off |
| `startScreenShare()` | Start screen sharing |
| `stopScreenShare()` | Stop screen sharing |
| `toggleScreenShare()` | Toggle screen sharing |
| `getStats()` | Get WebRTC connection stats |

### Host Controls (requires host role)

| Method | Description |
|--------|-------------|
| `muteParticipant(sessionId, targetId)` | Mute a participant |
| `muteAll(sessionId)` | Mute all participants |
| `unmuteAll(sessionId)` | Unmute all participants |
| `removeParticipant(sessionId, targetId)` | Remove a participant |
| `lockRoom(sessionId, locked)` | Lock/unlock the room |
| `endMeeting(sessionId)` | End the meeting for everyone |
| `transferHost(sessionId, targetId)` | Transfer host role |
| `toggleTranscription(sessionId, enabled)` | Enable/disable transcription |
| `enableWaitingRoom(sessionId, enabled)` | Enable/disable waiting room |
| `admitParticipant(sessionId, targetId)` | Admit from waiting room |
| `denyParticipant(sessionId, targetId)` | Deny from waiting room |
| `admitAll(sessionId)` | Admit all waiting participants |

### AI Features

| Method | Description |
|--------|-------------|
| `askAi(sessionId)` | Ask AI to respond with voice (ai-meeting) |
| `cancelAskAi(sessionId)` | Cancel ongoing AI voice response |
| `askAiText(sessionId, prompt?)` | Ask AI for a streamed text response |
| `generateSummary(sessionId)` | Generate AI meeting summary |
| `generateMinutes(sessionId)` | Generate AI meeting minutes |
| `addBookmark(sessionId, label, isActionItem?)` | Add a bookmark |
| `removeBookmark(sessionId, bookmarkId)` | Remove a bookmark |
| `getBookmarks(sessionId)` | Get all bookmarks |
| `getTranscript(sessionId)` | Get full transcript |
| `getSummaries(sessionId)` | Get all summaries |
| `getMinutes(sessionId)` | Get all minutes |

## License

MIT
