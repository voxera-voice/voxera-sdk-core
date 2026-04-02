# Voxera SDK - Core

Core TypeScript SDK for Voxera Voice Platform. Platform-agnostic client library.

## Features

- WebSocket connection management
- Voice chat session handling
- REST API client for configurations
- TypeScript-first with full type exports

## Installation

```bash
npm install @voxera/sdk-core
```

## Usage

```typescript
import { MayaVoiceClient } from '@voxera/sdk-core';

const client = new MayaVoiceClient({ apiKey: 'your-api-key' });
```

## Build

```bash
npm run build  # Uses tsup for ESM + CJS output
```
