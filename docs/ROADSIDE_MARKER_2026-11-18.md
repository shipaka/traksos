# Трасса: номер километра + направление — черновик

DRAFT / NO MERGE / NO DEPLOY.

Roadside location is more than GPS. The driver/client can optionally provide the highway, kilometer, direction of travel and side along the road. These details are stored within the existing orders.site structure, shown to all authorized case participants, and only the non-personal road markers are sent to executor candidates before acceptance. No phone number or personal meet/contact data is released.

Both repair and tow service requests support this information. When a completed repair becomes a tow continuation, the same location evidence is inherited unless the customer supplies a new site object. This is advisory evidence, not a verified road route, not a price region selector and not a legal proof of location.

Image evidence is intentionally NOT added in this step. Secure photo upload needs upload limits, moderation, access controls, retention and removal policy. GPS is separately optional and never silently inferred from a telephone or IP.

Before acceptance: test real Android WebView form, GPS opt-in and camera permission; unusual road kilometer inputs; mobile responsive layouts; CI, migration from main (no schema change); and how dispatchers see the location when connected to separate PR #162.
