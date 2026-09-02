---
name: Gemini model availability
description: Provider model availability can change independently of the SDK integration guidance.
---

The live Gemini API may reject an older model for newly provisioned users and return a replacement model in its error response. Treat that response as authoritative, update the server model explicitly, and retest the real endpoint without exposing the API key.

**Why:** The first live request rejected the initially selected model even though the code path and secret were valid.

**How to apply:** Keep Gemini calls server-side, use only models available to the current project/provider account, and verify one real request after any model change.