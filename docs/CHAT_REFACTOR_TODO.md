# Chat Refactor To-do

Status as of 2026-07-02. This tracks the focused `Chat.jsx` decomposition work on the frontend.

## Completed

- Stage 1: Extracted pure entity and payload helpers to `src/utils/chatHelpers.js`.
- Stage 2: Extracted chat search, snippets, preview hydration, and conversation search helpers to `src/utils/chatSearch.js`.
- Stage 3: Extracted `ConversationHeader.jsx` and `ArchivedTeamBanner.jsx`.
- Stage 4a: Extracted typing indicator state, typing timeout cleanup, typing user resolution, and active typing names to `src/hooks/useChatTyping.js`.
- Stage 4b: Extracted Socket.IO event wiring for messages, read status, conversation updates, team membership changes, deleted conversations, message edits/deletes, and notification-triggered team refreshes to `src/hooks/useChatSocketEvents.js`.
- Stage 4c: Extracted chat search query state, message search indexing, no-result toast handling, filtered conversation derivation, and search-panel visibility to `src/hooks/useChatSearchState.js`.

## Current Branch

- `refactor/chat-jsx-decomposition-stage-4c-search-state`
- Latest completed work: extracted chat search state and message indexing to `useChatSearchState`.

## Verification

- `npm run lint` passes with existing warnings.
- `npm run build` passes with the existing Vite chunk-size warning.
- Manual smoke passed:
  - DM typing indicator appears and clears.
  - DM send keeps the optimistic message without duplicate rendering.
  - Team chat typing indicator shows the expected display name.
  - Switching conversations does not leak old typing indicators.
  - New DM and incoming message update the active chat and conversation list.
  - Read status updates still render.
  - Message edit/delete socket updates still render.
  - Team chat membership/notification refresh paths still behave as expected.
  - Chat search filters by conversation metadata and message snippets.
  - Search-result selection still reveals and highlights the matching message.
  - No-result feedback still appears and can be dismissed.

## Next Recommended Work

- Stage 4d: Consider `useActiveChatConversation`.
  - Move conversation fetch/load, socket join/leave, read marking, highlighted message loading, and earlier-message pagination.

## Guardrails

- Keep one focused branch and one focused commit per extraction stage.
- Prefer verbatim moves where possible; behavior changes should be separate commits.
- After each stage, run `npm run lint`, `npm run build`, and a chat smoke test.
- Watch JSX imports manually: ESLint does not reliably catch all missing or stale uppercase component/icon imports in this repo.
