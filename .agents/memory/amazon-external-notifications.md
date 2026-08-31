---
name: Amazon external notification security
description: Security boundary and delivery contract for Amazon degradation webhooks
---

External notification destinations are treated as credentials: encrypt them at rest, never return them from the API, and only send a payload containing module, category, sample counts, and observed latency.

**Why:** A webhook URL grants posting access to the destination, while degradation notifications must remain actionable without leaking secrets or operational details.

**How to apply:** Preserve the masked configuration response and the provider-specific HTTPS validation when adding channels, delivery status, retries, or configuration flows.