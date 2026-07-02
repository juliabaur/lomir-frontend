# Chat Refactor To-do

Status as of 2026-07-02. This tracks the focused `Chat.jsx` decomposition work on the frontend.

## Completed

- Stage 1: Extracted pure entity and payload helpers to `src/utils/chatHelpers.js`.
- Stage 2: Extracted chat search, snippets, preview hydration, and conversation search helpers to `src/utils/chatSearch.js`.
- Stage 3: Extracted `ConversationHeader.jsx` and `ArchivedTeamBanner.jsx`.
- Stage 4a: Extracted typing indicator state, typing timeout cleanup, typing user resolution, and active typing names to `src/hooks/useChatTyping.js`.

## Current Branch

- `refactor/chat-jsx-decomposition-stage-4-hooks`
- Latest completed commit: `refactor(chat): extract typing state into custom hook`

## Verification

- `npm run lint` passes with existing warnings.
- `npm run build` passes with the existing Vite chunk-size warning.
- Manual smoke passed:
  - DM typing indicator appears and clears.
  - DM send keeps the optimistic message without duplicate rendering.
  - Team chat typing indicator shows the expected display name.
  - Switching conversations does not leak old typing indicators.

## Next Recommended Work

- Stage 4b: Extract `useChatSocketEvents`.
  - Move the large Socket.IO subscription block out of `Chat.jsx`.
  - Keep the hook API explicit: pass state setters, refs, cache refresh, team-access helpers, and navigation callbacks instead of importing page state indirectly.
  - Preserve current handling for `message:received`, `message:status`, `conversation:updated`, `team:member_left`, `conversation:deleted`, `team:member_kicked`, `message:deleted`, `message:edited`, and `notification:new`.
- Stage 4c: Consider `useChatSearchState`.
  - Move chat query state, message search indexing, no-result toast handling, and filtered conversation derivation.
  - Keep `pendingChatSearchTargetRef` integration with message loading explicit.
- Stage 4d: Consider `useActiveChatConversation`.
  - Move conversation fetch/load, socket join/leave, read marking, highlighted message loading, and earlier-message pagination.

## Guardrails

- Keep one focused branch and one focused commit per extraction stage.
- Prefer verbatim moves where possible; behavior changes should be separate commits.
- After each stage, run `npm run lint`, `npm run build`, and a chat smoke test.
- Watch JSX imports manually: ESLint does not reliably catch all missing or stale uppercase component/icon imports in this repo.
